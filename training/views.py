import calendar
import csv
from datetime import date, timedelta
import io
import json
import math

from django.db import IntegrityError, transaction
from django.http import HttpResponse, JsonResponse
from django.shortcuts import render
from django.utils import timezone
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST, require_http_methods

from .analytics import microcycle, serialize, summary
from .models import Activity, KINDS, MATCH_KINDS, Profile
from .tcx import parse_tcx, TCXError


def _profile():
    return Profile.objects.get_or_create(pk=1)[0]


def _error(message, status=400):
    return JsonResponse({'error': message}, status=status)


def _month(request):
    value = request.GET.get('month', timezone.localdate().strftime('%Y-%m'))
    year, month = map(int, value.split('-'))
    start = date(year, month, 1)
    return start, date(year, month, calendar.monthrange(year, month)[1])


@ensure_csrf_cookie
def index(request):
    return render(request, 'training/index.html')


@require_GET
def state(request):
    try:
        first, last = _month(request)
    except (ValueError, TypeError):
        return _error('Nieprawidłowy miesiąc.')
    config = _profile()
    activities = list(Activity.objects.filter(date__range=(first, last)))
    today = timezone.localdate()
    history = list(Activity.objects.filter(date__range=(today - timedelta(days=83), today), status='done'))
    matches = list(Activity.objects.filter(date__range=(first - timedelta(days=7), last + timedelta(days=7)), kind__in=MATCH_KINDS))
    next_match = Activity.objects.filter(date__gte=timezone.localdate(), kind__in=MATCH_KINDS).first()
    return JsonResponse({
        'activities': [serialize(a, config.limits()) for a in activities],
        'history': [serialize(a, config.limits()) for a in history],
        'summary': summary(activities, config.limits()),
        'profile': {'hr_max': config.hr_max, 'hr_lthr': config.hr_lthr, 'hr_rest': config.hr_rest,
                    'threshold_power': config.threshold_power, 'power_sport': config.power_sport, 'zone_limits': config.limits()},
        'kinds': KINDS,
        'next_match': serialize(next_match, config.limits()) if next_match else None,
        'microcycles': {(first + timedelta(days=i)).isoformat(): microcycle(first + timedelta(days=i), matches) for i in range((last - first).days + 1)},
    })


def _number(value, label, lower=0, upper=100000, integer=False, nullable=False):
    if nullable and value in (None, ''):
        return None
    try:
        number = float(value)
    except (ValueError, TypeError):
        raise ValueError('Nieprawidłowa wartość: ' + label)
    if not math.isfinite(number) or not lower <= number <= upper or (integer and not number.is_integer()):
        raise ValueError('Wartość poza zakresem: ' + label)
    return int(number) if integer else number


def _apply(activity, data):
    activity.date = date.fromisoformat(data['date'])
    activity.slot = _number(data['slot'], 'miejsce aktywności', 1, 2, integer=True)
    kind = data.get('kind', 'endurance')
    status = data.get('status', 'planned')
    if kind not in KINDS or status not in ('planned', 'done'):
        raise ValueError('Nieprawidłowy rodzaj lub status aktywności.')
    activity.kind, activity.status = kind, status
    activity.title = str(data.get('title', '')).strip()[:160]
    activity.notes = str(data.get('notes', '')).strip()[:5000]
    activity.duration_seconds = _number(data.get('duration_minutes', 0), 'czas (0–1440 min)', 0, 1440) * 60
    activity.distance_km = _number(data.get('distance_km', 0), 'dystans', 0, 1000)
    activity.rpe = _number(data.get('rpe'), 'RPE (1–10)', 1, 10, integer=True, nullable=True)
    activity.avg_hr = _number(data.get('avg_hr'), 'średnie tętno', 20, 250, integer=True, nullable=True)
    activity.max_hr = _number(data.get('max_hr'), 'maksymalne tętno', 20, 250, integer=True, nullable=True)
    if activity.avg_hr and activity.max_hr and activity.avg_hr > activity.max_hr:
        raise ValueError('Średnie tętno nie może być większe od maksymalnego.')
    if activity.status == 'done' and activity.duration_seconds <= 0:
        raise ValueError('Podaj czas wykonanej aktywności.')
    # Editing imported totals would break the relationship to the HR samples.
    if activity.source == 'tcx' and activity.pk:
        original = Activity.objects.get(pk=activity.pk)
        if abs(activity.duration_seconds - original.duration_seconds) > .5 or abs(activity.distance_km - original.distance_km) > .001:
            raise ValueError('Czas i dystans importu pochodzą z TCX. Aby je zmienić, zaimportuj poprawiony plik.')
        activity.avg_hr, activity.max_hr = original.avg_hr, original.max_hr


@require_POST
def save_activity(request):
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict):
            raise ValueError('Oczekiwano danych aktywności.')
        activity = Activity()
        _apply(activity, data)
        with transaction.atomic():
            activity.save()
    except (ValueError, KeyError, TypeError) as error:
        return _error(str(error) if isinstance(error, ValueError) else 'Uzupełnij poprawnie datę i miejsce aktywności.')
    except IntegrityError:
        return _error('To miejsce jest już zajęte. Każdy dzień ma dwie aktywności.', 409)
    return JsonResponse(serialize(activity, _profile().limits()), status=201)


@require_http_methods(['POST', 'DELETE'])
def activity_detail(request, pk):
    try:
        activity = Activity.objects.get(pk=pk)
    except Activity.DoesNotExist:
        return _error('Nie znaleziono aktywności.', 404)
    if request.method == 'DELETE':
        activity.delete()
        return JsonResponse({'deleted': True})
    try:
        data = json.loads(request.body)
        if not isinstance(data, dict):
            raise ValueError('Oczekiwano danych aktywności.')
        _apply(activity, data)
        with transaction.atomic():
            activity.save()
    except (ValueError, KeyError, TypeError) as error:
        return _error(str(error) if isinstance(error, ValueError) else 'Nieprawidłowe dane aktywności.')
    except IntegrityError:
        return _error('Wybrane miejsce jest już zajęte.', 409)
    return JsonResponse(serialize(activity, _profile().limits()))


@require_POST
def import_tcx(request):
    uploaded = request.FILES.get('file')
    if not uploaded or uploaded.size > 10 * 1024 * 1024:
        return _error('Wybierz plik TCX do 10 MB.')
    try:
        parsed = parse_tcx(uploaded.read())
        with transaction.atomic():
            if request.POST.get('activity_id'):
                activity = Activity.objects.select_for_update().get(pk=int(request.POST['activity_id']))
                parsed.pop('kind')
                parsed.pop('date')
            else:
                if request.POST.get('date'):
                    parsed['date'] = date.fromisoformat(request.POST['date'])
                occupied = set(Activity.objects.filter(date=parsed['date']).values_list('slot', flat=True))
                slot = next((s for s in (1, 2) if s not in occupied), None)
                if slot is None:
                    return _error('Ten dzień ma już dwie aktywności. Wybierz istniejącą aktywność i dołącz do niej TCX.', 409)
                activity = Activity(slot=slot)
            for key, value in parsed.items():
                setattr(activity, key, value)
            activity.status, activity.source = 'done', 'tcx'
            activity.imported_filename = uploaded.name[:200]
            activity.save()
    except (TCXError, ValueError, Activity.DoesNotExist) as error:
        return _error(str(error) if isinstance(error, TCXError) else 'Nieprawidłowa data lub aktywność docelowa.')
    except IntegrityError:
        return _error('To miejsce jest już zajęte.', 409)
    return JsonResponse(serialize(activity, _profile().limits()), status=201)


@require_POST
def profile(request):
    try:
        data = json.loads(request.body)
        maximum = _number(data['hr_max'], 'HRmax', 80, 250, integer=True)
        lthr = _number(data['hr_lthr'], 'próg LT', 60, maximum, integer=True)
        resting = _number(data['hr_rest'], 'tętno spoczynkowe', 25, lthr - 1, integer=True)
        power = _number(data['threshold_power'], 'próg mocy', 1, 2000, integer=True)
        sport = data.get('power_sport', 'running')
        if sport not in ('running', 'cycling'):
            raise ValueError('Wybierz rodzaj mocy.')
        limits = [_number(x, 'granice stref', 30, 249, integer=True) for x in data['zone_limits']]
        if len(limits) != 4 or limits != sorted(set(limits)) or limits[-1] >= maximum:
            raise ValueError('Podaj cztery rosnące granice stref poniżej HRmax.')
        config = _profile()
        config.hr_max, config.zone_limits = maximum, limits
        config.hr_lthr, config.hr_rest, config.threshold_power, config.power_sport = lthr, resting, power, sport
        config.save()
    except (ValueError, KeyError, TypeError) as error:
        return _error(str(error) if isinstance(error, ValueError) else 'Nieprawidłowe ustawienia stref.')
    return JsonResponse({'saved': True})


@require_GET
def export_csv(request):
    try:
        first, last = _month(request)
    except (ValueError, TypeError):
        return _error('Nieprawidłowy miesiąc.')
    stream = io.StringIO()
    writer = csv.writer(stream, delimiter=';')
    writer.writerow(['Data', 'Miejsce', 'Rodzaj', 'Nazwa', 'Status', 'Czas (min)', 'Dystans (km)', 'HR średnie', 'HR max', 'RPE', 'Obciążenie sRPE', 'Z1 (min)', 'Z2 (min)', 'Z3 (min)', 'Z4 (min)', 'Z5 (min)', 'Bez danych HR (min)', 'Notatki'])
    limits = _profile().limits()
    def safe(value):
        text = str(value)
        return "'" + text if text.lstrip().startswith(('=', '+', '-', '@')) else text
    for activity in Activity.objects.filter(date__range=(first, last)):
        data = serialize(activity, limits)
        writer.writerow([activity.date, activity.slot, KINDS[activity.kind], safe(activity.title), activity.get_status_display(), data['duration_minutes'], activity.distance_km, activity.avg_hr or '', activity.max_hr or '', activity.rpe or '', data['load'] or '', *[round(x / 60, 2) for x in data['zones_seconds']], round(data['unknown_hr_seconds'] / 60, 2), safe(activity.notes)])
    response = HttpResponse('\ufeff' + stream.getvalue(), content_type='text/csv; charset=utf-8')
    response['Content-Disposition'] = 'attachment; filename="treningi-{}.csv"'.format(first.strftime('%Y-%m'))
    return response
