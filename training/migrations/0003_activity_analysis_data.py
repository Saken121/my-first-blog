from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('training', '0002_activity_running_kinds'),
    ]

    operations = [
        migrations.AddField(
            model_name='activity',
            name='splits',
            field=models.JSONField(default=list),
        ),
        migrations.AddField(
            model_name='activity',
            name='peak_metrics',
            field=models.JSONField(default=dict),
        ),
    ]
