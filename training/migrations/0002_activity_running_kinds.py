from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('training', '0001_initial'),
    ]

    operations = [
        migrations.AlterField(
            model_name='activity',
            name='kind',
            field=models.CharField(
                choices=[
                    ('endurance', 'Bieg spokojny'),
                    ('recovery_run', 'Bieg regeneracyjny'),
                    ('recovery_stretch', 'Rozciąganie regeneracyjne'),
                    ('starts', 'Starty biegowe'),
                    ('short_sprints', 'Krótkie sprinty'),
                    ('fast_intervals', 'Szybkie biegi interwałowe'),
                    ('tempo_intervals', 'Interwały tempowe'),
                    ('tempo_run', 'Bieg tempowy'),
                    ('intervals', 'Interwały'),
                    ('speed', 'Szybkość i sprinty'),
                    ('strength', 'Siła'),
                    ('mobility', 'Mobilność'),
                    ('recovery', 'Regeneracja aktywna'),
                    ('cycling', 'Rower'),
                    ('test', 'Test sprawnościowy'),
                    ('match_iii', 'Mecz · III liga'),
                    ('match_district', 'Mecz · liga okręgowa'),
                    ('match_assistant', 'Mecz · sędzia asystent'),
                    ('other', 'Inna aktywność'),
                ],
                default='endurance',
                max_length=32,
            ),
        ),
    ]
