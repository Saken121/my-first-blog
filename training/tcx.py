"""TCX parsing with safe XML and time-weighted heart-rate samples."""
from collections import defaultdict
from datetime import datetime
import math
from zoneinfo import ZoneInfo

from defusedxml import ElementTree
from defusedxml.common import DefusedXmlException


class TCXError(ValueError):
    pass


def _tag(element):
    return element.tag.rsplit('}', 1)[-1]


def _children(element, name):
    return [child for child in element if _tag(child) == name]


def _number(element, name):
    for child in element.iter():
        if _tag(child) == name and child.text:
            try:
                value = float(child.text)
                if math.isfinite(value) and value >= 0:
                    return value
            except ValueError:
                pass
    return None


def _time(value):
    try:
        result = datetime.fromisoformat(value.strip().replace('Z', '+00:00'))
        if result.tzinfo is None:
            raise ValueError('Missing timezone')
        return result
    except (ValueError, AttributeError):
        raise TCXError('Nieprawidłowy czas w pliku TCX (wymagana strefa czasowa).')


def parse_tcx(data):
    if not data or len(data) > 10 * 1024 * 1024:
        raise TCXError('Plik TCX musi mieć od 1 bajta do 10 MB.')
    try:
        root = ElementTree.fromstring(data)
    except (ElementTree.ParseError, DefusedXmlException, ValueError):
        raise TCXError('Nieprawidłowy lub niedozwolony plik XML/TCX.')
    if _tag(root) != 'TrainingCenterDatabase':
        raise TCXError('To nie jest plik Garmin TCX.')
    activities = [node for node in root.iter() if _tag(node) == 'Activity']
    if len(activities) != 1:
        raise TCXError('Importuj plik TCX zawierający jedną aktywność.')
    activity = activities[0]
    starts, timestamps, hearts, powers = [], [], [], []
    durations, distances = [], []
    segments = defaultdict(float)
    power_weighted = power_seconds = 0
    fallback_distance = 0
    for lap in _children(activity, 'Lap'):
        if lap.get('StartTime'):
            starts.append(_time(lap.get('StartTime')))
        for name, target in [('TotalTimeSeconds', durations), ('DistanceMeters', distances)]:
            for node in _children(lap, name):
                value = _number(node, name)
                if value is not None:
                    target.append(value)
        for track in _children(lap, 'Track'):
            previous = None
            for point in _children(track, 'Trackpoint'):
                times = _children(point, 'Time')
                timestamp = _time(times[0].text) if times else None
                hr_nodes = _children(point, 'HeartRateBpm')
                hr = _number(hr_nodes[0], 'Value') if hr_nodes else None
                hr = round(hr) if hr is not None and 20 <= hr <= 250 else None
                distance = _number(point, 'DistanceMeters')
                power = _number(point, 'Watts')
                if power is not None and power > 5000:
                    power = None
                if power is not None:
                    powers.append(power)
                if timestamp:
                    timestamps.append(timestamp)
                if hr:
                    hearts.append(hr)
                if previous:
                    prev_time, prev_hr, prev_distance, prev_power = previous
                    if timestamp and prev_time:
                        seconds = (timestamp - prev_time).total_seconds()
                        # Do not assign pause gaps or gaps between tracks to a HR zone.
                        if 0 < seconds <= 120 and prev_hr:
                            segments[prev_hr] += seconds
                        if 0 < seconds <= 120 and prev_power is not None:
                            power_weighted += prev_power * seconds
                            power_seconds += seconds
                    if distance is not None and prev_distance is not None:
                        fallback_distance += max(0, distance - prev_distance)
                previous = (timestamp, hr, distance, power)
    if not starts and not timestamps:
        ids = _children(activity, 'Id')
        if ids:
            starts.append(_time(ids[0].text))
    times = starts + timestamps
    if not times:
        raise TCXError('Plik nie zawiera daty aktywności.')
    duration = sum(durations) if durations else (max(times) - min(times)).total_seconds()
    if not math.isfinite(duration) or duration <= 0 or duration > 86400:
        raise TCXError('Brak poprawnego czasu aktywności (maksymalnie 24 godziny).')
    covered = sum(segments.values())
    if covered > duration:
        segments = {hr: seconds * duration / covered for hr, seconds in segments.items()}
        covered = duration
    avg_hr = round(sum(hr * seconds for hr, seconds in segments.items()) / covered) if covered else None
    if avg_hr is None:
        for lap in _children(activity, 'Lap'):
            nodes = _children(lap, 'AverageHeartRateBpm')
            if nodes:
                avg_hr = _number(nodes[0], 'Value')
                if avg_hr and 20 <= avg_hr <= 250:
                    avg_hr = round(avg_hr)
                    break
                avg_hr = None
    max_hr = max(hearts) if hearts else None
    if max_hr is None:
        values = [_number(node, 'Value') for node in activity.iter() if _tag(node) == 'MaximumHeartRateBpm']
        values = [v for v in values if v is not None and 20 <= v <= 250]
        max_hr = round(max(values)) if values else None
    meters = sum(distances) if distances else fallback_distance
    if not math.isfinite(meters):
        raise TCXError('Nieprawidłowy dystans w TCX.')
    return {
        'date': min(times).astimezone(ZoneInfo('Europe/Warsaw')).date(),
        'duration_seconds': round(duration, 2),
        'distance_km': round(meters / 1000, 3),
        'avg_hr': avg_hr,
        'max_hr': max_hr,
        'hr_segments': [[hr, round(seconds, 3)] for hr, seconds in sorted(segments.items())],
        'kind': 'cycling' if activity.get('Sport') == 'Biking' else 'endurance',
        'avg_power': round(power_weighted / power_seconds) if power_seconds else None,
        'max_power': round(max(powers)) if powers else None,
    }
