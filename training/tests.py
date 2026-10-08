from datetime import date, timedelta
import json

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import Client, TestCase, SimpleTestCase

from .analytics import microcycle, summary
from .models import Activity, Profile
from .tcx import TCXError, parse_tcx


TCX = b'''<?xml version="1.0"?><TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:ext="http://www.garmin.com/xmlschemas/ActivityExtension/v2"><Activities><Activity Sport="Running"><Id>2026-10-10T10:00:00Z</Id><Lap StartTime="2026-10-10T10:00:00Z"><TotalTimeSeconds>180</TotalTimeSeconds><DistanceMeters>3000</DistanceMeters><Track><Trackpoint><Time>2026-10-10T10:00:00Z</Time><DistanceMeters>0</DistanceMeters><HeartRateBpm><Value>100</Value></HeartRateBpm><Extensions><ext:TPX><ext:Watts>200</ext:Watts></ext:TPX></Extensions></Trackpoint><Trackpoint><Time>2026-10-10T10:01:00Z</Time><DistanceMeters>1000</DistanceMeters><HeartRateBpm><Value>161</Value></HeartRateBpm><Extensions><ext:TPX><ext:Watts>300</ext:Watts></ext:TPX></Extensions></Trackpoint><Trackpoint><Time>2026-10-10T10:02:00Z</Time><DistanceMeters>3000</DistanceMeters><HeartRateBpm><Value>180</Value></HeartRateBpm><Extensions><ext:TPX><ext:Watts>450</ext:Watts></ext:TPX></Extensions></Trackpoint></Track></Lap></Activity></Activities></TrainingCenterDatabase>'''


class ParserTests(SimpleTestCase):
    def test_namespaces_and_weighted_samples(self):
        result = parse_tcx(TCX)
        self.assertEqual(result['duration_seconds'], 180)
        self.assertEqual(result['distance_km'], 3)
        self.assertEqual(result['avg_hr'], 130)
        self.assertEqual(result['max_hr'], 180)
        self.assertEqual(result['hr_segments'], [[100, 60], [161, 60]])
        self.assertEqual(result['avg_power'], 250)
        self.assertEqual(result['max_power'], 450)

    def test_warsaw_date_across_midnight(self):
        result = parse_tcx(TCX.replace(b'2026-10-10T10:', b'2026-10-10T23:'))
        self.assertEqual(result['date'], date(2026, 10, 11))

    def test_missing_hr_stays_unknown(self):
        result = parse_tcx(TCX.replace(b'HeartRateBpm', b'UnusedHeartRate'))
        self.assertIsNone(result['avg_hr'])
        self.assertEqual(result['hr_segments'], [])

    def test_long_gaps_are_not_attributed_to_hr(self):
        modified = TCX.replace(b'T10:01:00Z', b'T10:05:00Z').replace(b'T10:02:00Z', b'T10:10:00Z')
        self.assertEqual(parse_tcx(modified)['hr_segments'], [])

    def test_entity_expansion_rejected(self):
        xml = b'<!DOCTYPE root [<!ENTITY x "expanded">]><TrainingCenterDatabase>&x;</TrainingCenterDatabase>'
        with self.assertRaises(TCXError):
            parse_tcx(xml)

    def test_invalid_and_non_tcx_rejected(self):
        for value in [b'', b'<bad>', b'<root/>', TCX.replace(b'<TotalTimeSeconds>180', b'<TotalTimeSeconds>nan')[:200]]:
            with self.subTest(value=value[:20]), self.assertRaises(TCXError):
                parse_tcx(value)

    def test_duration_fallback_uses_trackpoints(self):
        result = parse_tcx(TCX.replace(b'<TotalTimeSeconds>180</TotalTimeSeconds>', b''))
        self.assertEqual(result['duration_seconds'], 120)


class WorkflowTests(TestCase):
    def post(self, path, values):
        return self.client.post(path, json.dumps(values), content_type='application/json')

    def activity(self, **updates):
        result = {'date': '2026-10-10', 'slot': 1, 'kind': 'endurance', 'status': 'done', 'duration_minutes': 30, 'distance_km': 5, 'rpe': 4}
        result.update(updates)
        return result

    def upload(self, **kwargs):
        return self.client.post('/api/import/', {'file': SimpleUploadedFile('garmin.tcx', TCX, 'application/xml'), **kwargs})

    def test_calendar_page_and_personalized_settings(self):
        response = self.client.get('/')
        self.assertContains(response, 'Twój plan. Twój rytm.')
        state = self.client.get('/api/state/?month=2026-10').json()
        self.assertEqual(state['profile']['zone_limits'], [150, 159, 168, 176])
        self.assertEqual(state['profile']['threshold_power'], 411)

    def test_two_slots_and_collision(self):
        self.assertEqual(self.post('/api/activities/', self.activity()).status_code, 201)
        self.assertEqual(self.post('/api/activities/', self.activity(slot=2)).status_code, 201)
        self.assertEqual(self.post('/api/activities/', self.activity()).status_code, 409)
        self.assertEqual(Activity.objects.count(), 2)

    def test_invalid_values_cannot_be_saved(self):
        for updates in [{'slot': 3}, {'rpe': 11}, {'duration_minutes': 0}, {'distance_km': -1}, {'date': 'bad'}, {'kind': 'unknown'}, {'rpe': 4.5}, {'duration_minutes': float('nan')}]:
            with self.subTest(updates=updates):
                self.assertEqual(self.post('/api/activities/', self.activity(**updates)).status_code, 400)
        self.assertEqual(Activity.objects.count(), 0)

    def test_edit_and_delete(self):
        saved = self.post('/api/activities/', self.activity()).json()
        self.assertEqual(self.post('/api/activities/{}/'.format(saved['id']), self.activity(title='Test zmiany', slot=2)).status_code, 200)
        self.assertEqual(Activity.objects.get().title, 'Test zmiany')
        self.assertEqual(self.client.delete('/api/activities/{}/'.format(saved['id'])).status_code, 200)
        self.assertEqual(Activity.objects.count(), 0)

    def test_completed_only_summary_and_load(self):
        self.post('/api/activities/', self.activity())
        self.post('/api/activities/', self.activity(slot=2, status='planned', duration_minutes=90))
        stats = self.client.get('/api/state/?month=2026-10').json()['summary']
        self.assertEqual(stats['minutes'], 30)
        self.assertEqual(stats['load'], 120)
        self.assertEqual(stats['planned'], 1)
        self.assertEqual(stats['unknown_hr_seconds'], 1800)

    def test_all_match_types_and_microcycles(self):
        for index, kind in enumerate(['match_iii', 'match_district', 'match_assistant']):
            self.post('/api/activities/', self.activity(date='2026-10-{}'.format(10 + index * 7), kind=kind))
        state = self.client.get('/api/state/?month=2026-10').json()
        self.assertEqual(state['summary']['matches'], 3)
        self.assertEqual(state['microcycles']['2026-10-10']['badge'], 'MD')
        self.assertEqual(state['microcycles']['2026-10-11']['badge'], 'MD+1')
        self.assertEqual(state['microcycles']['2026-10-09']['badge'], 'MD−1')

    def test_import_and_time_in_zones(self):
        response = self.upload()
        self.assertEqual(response.status_code, 201)
        activity = response.json()
        self.assertEqual(activity['zones_seconds'], [60, 0, 60, 0, 0])
        self.assertEqual(activity['unknown_hr_seconds'], 60)
        self.assertEqual(activity['avg_power'], 250)
        self.assertEqual(activity['status'], 'done')

    def test_import_uses_free_slot_and_does_not_overwrite(self):
        self.post('/api/activities/', self.activity(title='Zachowaj mnie'))
        self.assertEqual(self.upload().json()['slot'], 2)
        self.assertEqual(self.upload().status_code, 409)
        self.assertEqual(Activity.objects.get(slot=1).title, 'Zachowaj mnie')

    def test_attach_tcx_preserves_match_plan(self):
        planned = self.post('/api/activities/', self.activity(date='2026-10-12', kind='match_iii', title='Mecz', notes='Moje notatki', status='planned')).json()
        response = self.upload(activity_id=planned['id']).json()
        self.assertEqual(response['date'], '2026-10-12')
        self.assertEqual(response['kind'], 'match_iii')
        self.assertEqual(response['rpe'], 4)
        self.assertEqual(response['notes'], 'Moje notatki')
        self.assertEqual(Activity.objects.count(), 1)

    def test_changing_zones_recalculates_existing_import(self):
        self.upload()
        values = {'hr_max':199,'hr_lthr':177,'hr_rest':57,'threshold_power':411,'power_sport':'running','zone_limits':[110,170,180,190]}
        self.assertEqual(self.post('/api/profile/', values).status_code, 200)
        state = self.client.get('/api/state/?month=2026-10').json()
        self.assertEqual(state['summary']['zones_seconds'], [60, 60, 0, 0, 0])

    def test_imported_time_cannot_be_changed_without_samples(self):
        imported = self.upload().json()
        values = self.activity(duration_minutes=60)
        response = self.post('/api/activities/{}/'.format(imported['id']), values)
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Activity.objects.get().duration_seconds, 180)

    def test_profile_invalid_zones_do_not_change_settings(self):
        values = {'hr_max':199,'hr_lthr':177,'hr_rest':57,'threshold_power':411,'zone_limits':[170,150,160,180]}
        self.assertEqual(self.post('/api/profile/', values).status_code, 400)

    def test_export_utf8_formula_protection_and_month_filter(self):
        self.post('/api/activities/', self.activity(title='=FORMULA()', notes='@formula'))
        self.post('/api/activities/', self.activity(date='2026-11-01', title='Kolejny miesiąc'))
        response = self.client.get('/api/export/?month=2026-10')
        self.assertEqual(response.status_code, 200)
        self.assertIn("'=FORMULA()", response.content.decode('utf-8-sig'))
        self.assertIn("'@formula", response.content.decode('utf-8-sig'))
        self.assertNotIn('Kolejny miesiąc', response.content.decode('utf-8-sig'))

    def test_csrf_is_required_for_writes(self):
        client = Client(enforce_csrf_checks=True)
        self.assertEqual(client.post('/api/activities/', json.dumps(self.activity()), content_type='application/json').status_code, 403)

    def test_month_boundary_match_is_considered(self):
        Activity.objects.create(date=date(2026,11,1),slot=1,kind='match_iii')
        state = self.client.get('/api/state/?month=2026-10').json()
        self.assertEqual(state['microcycles']['2026-10-31']['badge'], 'MD−1')

    def test_close_matches_prioritize_recovery(self):
        matches = [Activity(date=date(2026,10,10),kind='match_iii'), Activity(date=date(2026,10,12),kind='match_iii')]
        self.assertEqual(microcycle(date(2026,10,11), matches)['badge'], 'MD+1')
