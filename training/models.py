from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


KINDS = {
    'endurance': 'Bieg spokojny',
    'recovery_run': 'Bieg regeneracyjny',
    'recovery_stretch': 'Rozciąganie regeneracyjne',
    'starts': 'Starty biegowe',
    'short_sprints': 'Krótkie sprinty',
    'fast_intervals': 'Szybkie biegi interwałowe',
    'tempo_intervals': 'Interwały tempowe',
    'tempo_run': 'Bieg tempowy',
    'intervals': 'Interwały',
    'speed': 'Szybkość i sprinty',
    'strength': 'Siła',
    'mobility': 'Mobilność',
    'recovery': 'Regeneracja aktywna',
    'cycling': 'Rower',
    'test': 'Test sprawnościowy',
    'match_iii': 'Mecz · III liga',
    'match_district': 'Mecz · liga okręgowa',
    'match_assistant': 'Mecz · sędzia asystent',
    'other': 'Inna aktywność',
}
MATCH_KINDS = ('match_iii', 'match_district', 'match_assistant')


class Profile(models.Model):
    hr_max = models.PositiveIntegerField(default=199)
    hr_lthr = models.PositiveIntegerField(default=177)
    hr_rest = models.PositiveIntegerField(default=57)
    threshold_power = models.PositiveIntegerField(default=411)
    power_sport = models.CharField(max_length=12, default='running')
    zone_limits = models.JSONField(default=list)

    def limits(self):
        import math
        return self.zone_limits or [math.ceil(self.hr_lthr * x) - 1 for x in (.85, .90, .95, 1)]


class Activity(models.Model):
    date = models.DateField()
    slot = models.PositiveSmallIntegerField(validators=[MinValueValidator(1), MaxValueValidator(2)])
    kind = models.CharField(max_length=32, choices=list(KINDS.items()), default='endurance')
    title = models.CharField(max_length=160, blank=True)
    status = models.CharField(max_length=12, choices=[('planned', 'Plan'), ('done', 'Wykonana')], default='planned')
    duration_seconds = models.FloatField(default=0)
    distance_km = models.FloatField(default=0)
    avg_hr = models.PositiveIntegerField(null=True, blank=True)
    max_hr = models.PositiveIntegerField(null=True, blank=True)
    rpe = models.PositiveSmallIntegerField(null=True, blank=True)
    notes = models.TextField(blank=True)
    source = models.CharField(max_length=12, default='manual')
    hr_segments = models.JSONField(default=list)
    imported_filename = models.CharField(max_length=200, blank=True)
    avg_power = models.PositiveIntegerField(null=True, blank=True)
    max_power = models.PositiveIntegerField(null=True, blank=True)
    splits = models.JSONField(default=list)
    peak_metrics = models.JSONField(default=dict)

    class Meta:
        ordering = ['date', 'slot']
        constraints = [
            models.UniqueConstraint(fields=['date', 'slot'], name='two_daily_slots'),
            models.CheckConstraint(condition=models.Q(slot__in=[1, 2]), name='valid_daily_slot'),
        ]

    def __str__(self):
        return self.title or KINDS[self.kind]
