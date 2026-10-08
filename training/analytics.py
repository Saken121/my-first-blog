from collections import defaultdict
from datetime import timedelta

from .models import KINDS, MATCH_KINDS


def zone_times(activity, limits):
    result = [0.0] * 5
    for hr, seconds in activity.hr_segments:
        index = sum(hr > limit for limit in limits)
        result[index] += seconds
    return result


def serialize(activity, limits):
    zones = zone_times(activity, limits)
    return {
        'id': activity.pk, 'date': activity.date.isoformat(), 'slot': activity.slot,
        'kind': activity.kind, 'kind_label': KINDS[activity.kind], 'title': activity.title,
        'status': activity.status, 'duration_minutes': round(activity.duration_seconds / 60, 2),
        'distance_km': activity.distance_km, 'avg_hr': activity.avg_hr, 'max_hr': activity.max_hr,
        'rpe': activity.rpe, 'notes': activity.notes, 'source': activity.source,
        'imported_filename': activity.imported_filename,
        'avg_power': activity.avg_power, 'max_power': activity.max_power,
        'zones_seconds': zones,
        'unknown_hr_seconds': max(0, activity.duration_seconds - sum(zones)),
        'load': round(activity.duration_seconds / 60 * activity.rpe) if activity.rpe else None,
        'is_match': activity.kind in MATCH_KINDS,
    }


def summary(activities, limits):
    done = [a for a in activities if a.status == 'done']
    zones = [0.0] * 5
    types, weeks = defaultdict(lambda: {'count': 0, 'minutes': 0}), defaultdict(lambda: {'load': 0, 'minutes': 0, 'count': 0, 'unrated': 0})
    weighted_hr, covered = 0, 0
    for activity in done:
        seconds = zone_times(activity, limits)
        zones = [x + y for x, y in zip(zones, seconds)]
        types[activity.kind]['count'] += 1
        types[activity.kind]['minutes'] += activity.duration_seconds / 60
        week = (activity.date - timedelta(days=activity.date.weekday())).isoformat()
        weeks[week]['minutes'] += activity.duration_seconds / 60
        weeks[week]['count'] += 1
        if activity.rpe:
            weeks[week]['load'] += activity.duration_seconds / 60 * activity.rpe
        else:
            weeks[week]['unrated'] += 1
        for hr, duration in activity.hr_segments:
            weighted_hr += hr * duration
            covered += duration
    return {
        'completed': len(done), 'planned': sum(a.status == 'planned' for a in activities),
        'matches': sum(a.kind in MATCH_KINDS for a in done),
        'minutes': round(sum(a.duration_seconds for a in done) / 60, 1),
        'distance_km': round(sum(a.distance_km for a in done), 2),
        'load': round(sum(a.duration_seconds / 60 * a.rpe for a in done if a.rpe)),
        'unrated': sum(a.rpe is None for a in done),
        'avg_hr': round(weighted_hr / covered) if covered else None,
        'max_hr': max((a.max_hr for a in done if a.max_hr), default=None),
        'zones_seconds': zones,
        'unknown_hr_seconds': max(0, sum(a.duration_seconds for a in done) - sum(zones)),
        'types': [{'kind': kind, 'label': KINDS[kind], **value} for kind, value in types.items()],
        'weeks': [{'date': date, **value} for date, value in sorted(weeks.items())],
    }


def microcycle(day, matches):
    dates = sorted({a.date for a in matches})
    if day in dates:
        return {'badge': 'MD', 'label': 'Dzień meczowy', 'kind': 'mobility', 'minutes': 15, 'rpe': 2, 'description': 'Rozgrzewka przed meczem; po meczu spokojne schłodzenie. Bez dodatkowego ciężkiego treningu.'}
    previous = max((d for d in dates if d < day), default=None)
    following = min((d for d in dates if d > day), default=None)
    since = (day - previous).days if previous else None
    until = (following - day).days if following else None
    if since == 1:
        return {'badge': 'MD+1', 'label': 'Odbudowa po meczu', 'kind': 'recovery', 'minutes': 25, 'rpe': 2, 'description': 'Lekki ruch i mobilność. Dostosuj czas do zmęczenia i obciążenia meczu.'}
    if until == 1:
        return {'badge': 'MD−1', 'label': 'Aktywacja przed meczem', 'kind': 'speed', 'minutes': 20, 'rpe': 3, 'description': 'Krótka aktywacja i kilka swobodnych przyspieszeń, z pełnym odpoczynkiem.'}
    if since == 2:
        return {'badge': 'MD+2', 'label': 'Spokojny powrót', 'kind': 'endurance', 'minutes': 30, 'rpe': 3, 'description': 'Spokojny wysiłek tlenowy. Przy utrzymującym się zmęczeniu wybierz regenerację.'}
    if until == 2:
        return {'badge': 'MD−2', 'label': 'Zmniejszenie objętości', 'kind': 'endurance', 'minutes': 30, 'rpe': 3, 'description': 'Lekki bieg i technika. Zostaw zapas energii na mecz.'}
    if until == 3:
        return {'badge': 'MD−3', 'label': 'Bodziec jakościowy', 'kind': 'intervals', 'minutes': 40, 'rpe': 6, 'description': 'Miejsce na interwały lub szybkość, jeśli jesteś zregenerowany. Uwzględnij rozgrzewkę i schłodzenie.'}
    return {'badge': 'BAZA', 'label': 'Dzień budowania formy', 'kind': 'endurance', 'minutes': 40, 'rpe': 4, 'description': 'Trening tlenowy lub siła według Twojego planu. Wybierz odpoczynek, jeśli go potrzebujesz.'}
