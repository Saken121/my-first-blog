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


def _split_row(distance_m, duration, points):
    heart_rates = [point[2] for point in points if point[2] is not None]
    powers = [point[3] for point in points if point[3] is not None]
    return {
        'distance_km': round(distance_m / 1000, 3),
        'duration_seconds': round(duration, 2),
        'avg_hr': round(sum(heart_rates) / len(heart_rates)) if heart_rates else None,
        'max_hr': max(heart_rates) if heart_rates else None,
        'avg_power': round(sum(powers) / len(powers)) if powers else None,
        'max_power': round(max(powers)) if powers else None,
    }


def _automatic_splits(points):
    points = sorted((p for p in points if p[0] is not None and p[1] is not None), key=lambda p: p[0])
    if len(points) < 2:
        return []
    first = points[0]
    start_time, start_distance = first[0], first[1]
    boundary = start_distance + 1000
    chunk = [first]
    result = []
    previous = first
    for current in points[1:]:
        if current[0] <= previous[0]:
            previous = current
            continue
        if current[0] - previous[0] > 120 or current[1] < previous[1]:
            start_time, start_distance = current[0], current[1]
            boundary, chunk = start_distance + 1000, [current]
            previous = current
            continue
        while current[1] >= boundary and current[1] > previous[1]:
            fraction = (boundary - previous[1]) / (current[1] - previous[1])
            split_time = previous[0] + fraction * (current[0] - previous[0])
            interpolated = (split_time, boundary, None, None)
            samples = [p for p in chunk if start_time <= p[0] < split_time] + [interpolated]
            elapsed, distance = split_time - start_time, boundary - start_distance
            if elapsed > 0 and distance > 0:
                result.append(_split_row(distance, elapsed, samples))
            start_time, start_distance = split_time, boundary
            chunk = [interpolated]
            boundary += 1000
        chunk.append(current)
        previous = current
    end_time, end_distance = points[-1][0], points[-1][1]
    distance = end_distance - start_distance
    if distance > 20 and end_time > start_time:
        samples = [p for p in chunk if start_time <= p[0] <= end_time]
        result.append(_split_row(distance, end_time - start_time, samples))
    return result


def _peak_speed(points, window):
    values = None
    for end in range(1, len(points)):
        end_time, end_distance = points[end][0], points[end][1]
        for start in range(end - 1, -1, -1):
            elapsed = end_time - points[start][0]
            if elapsed > window * 1.2:
                break
            if elapsed < window * .8 or elapsed <= 0:
                continue
            distance = end_distance - points[start][1]
            speed = distance / elapsed * 3.6
            if distance >= window * 2 and speed <= 45 and (values is None or speed > values):
                values = speed
    return round(values, 2) if values is not None else None


def _peak_power(points, window=5):
    best = None
    for end in range(1, len(points)):
        end_time = points[end][0]
        for start in range(end - 1, -1, -1):
            elapsed = end_time - points[start][0]
            if elapsed > window * 1.2:
                break
            if elapsed < window * .8 or elapsed <= 0:
                continue
            powers = [p[3] for p in points[start:end + 1] if p[3] is not None]
            if len(powers) >= 2:
                value = sum(powers) / len(powers)
                if best is None or value > best:
                    best = value
    return round(best) if best is not None else None


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
    all_track_points, lap_records = [], []
    for lap in _children(activity, 'Lap'):
        if lap.get('StartTime'):
            starts.append(_time(lap.get('StartTime')))
        for name, target in [('TotalTimeSeconds', durations), ('DistanceMeters', distances)]:
            for node in _children(lap, name):
                value = _number(node, name)
                if value is not None:
                    target.append(value)
        lap_points = []
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
                if timestamp and distance is not None:
                    lap_points.append((timestamp.timestamp(), distance, hr, power))
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
        lap_points.sort(key=lambda point: point[0])
        all_track_points.extend(lap_points)
        lap_duration = _number(lap, 'TotalTimeSeconds')
        lap_distance = _number(lap, 'DistanceMeters')
        if lap_duration and lap_distance and lap_distance > 0:
            avg_nodes = _children(lap, 'AverageHeartRateBpm')
            max_nodes = _children(lap, 'MaximumHeartRateBpm')
            avg_hr_lap = _number(avg_nodes[0], 'Value') if avg_nodes else None
            max_hr_lap = _number(max_nodes[0], 'Value') if max_nodes else None
            lap_row = _split_row(lap_distance, lap_duration, lap_points)
            if avg_hr_lap and 20 <= avg_hr_lap <= 250:
                lap_row['avg_hr'] = round(avg_hr_lap)
            if max_hr_lap and 20 <= max_hr_lap <= 250:
                lap_row['max_hr'] = round(max_hr_lap)
            lap_records.append(lap_row)
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
    valid_laps = [lap for lap in lap_records if lap['duration_seconds'] > 0 and lap['distance_km'] > 0]
    kilometer_splits = _automatic_splits(all_track_points)
    splits = valid_laps if len(valid_laps) > 1 else kilometer_splits
    split_mode = 'laps' if len(valid_laps) > 1 else 'kilometers' if splits else ''
    pace_splits = kilometer_splits or splits
    one_km_paces = [s['duration_seconds'] / s['distance_km'] for s in pace_splits if .9 <= s['distance_km'] <= 1.1]
    track_points = sorted(all_track_points, key=lambda point: point[0])
    peak_metrics = {
        'speed_5s_kmh': _peak_speed(track_points, 5),
        'speed_30s_kmh': _peak_speed(track_points, 30),
        'best_1km_pace_seconds': round(min(one_km_paces), 2) if one_km_paces else None,
        'power_5s_w': _peak_power(track_points),
        'max_hr_bpm': max_hr,
        'split_mode': split_mode,
    }
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
        'splits': splits,
        'peak_metrics': peak_metrics,
    }
