"""Build the dependency-free, single-file end-user application."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, help='Output directory; defaults to downloads/')
parser.add_argument('--app-name', default='Forma', help='Name shown in the standalone app')
parser.add_argument('--storage-key', help='Isolated localStorage key; defaults to a name-specific key')
parser.add_argument('--html-name', help='Output HTML filename')
parser.add_argument('--zip-name', help='Output ZIP filename')
args = parser.parse_args()
storage_key = args.storage_key or ('forma.referee.v1' if args.app_name == 'Forma' else f'{args.app_name.lower()}.journal.v1')

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / 'training/templates/training/index.html').read_text()
css = (ROOT / 'training/static/training/app.css').read_text()
local = (ROOT / 'training/static/training/local.js').read_text()
app = (ROOT / 'training/static/training/app.js').read_text()
local = local.replace("const KEY='forma.referee.v1';", f"const KEY='{storage_key}';")
html = html.replace('{% load static %}\n', '')
html = html.replace("<link rel=\"stylesheet\" href=\"{% static 'training/app.css' %}\">", '<style>' + css + '\n.toolbar-actions{flex-wrap:wrap}.offline-note{display:flex;gap:10px;align-items:center;justify-content:space-between;background:#eaf0e7;border:1px solid #dce5d6;border-radius:8px;padding:12px 16px;margin-bottom:22px;font-size:11px;color:#68815e}.backup-buttons{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.backup-buttons>label{cursor:pointer}.backup-buttons input{max-width:100%}@media(max-width:730px){.offline-note{font-size:10px;line-height:1.7;align-items:flex-start}.toolbar-actions{gap:12px}}\n</style>')
html = html.replace("  <script src=\"{% static 'training/app.js' %}\" defer></script>\n", '')
html = html.replace('class="brand" href="/"', 'class="brand" href="#"')
html = html.replace('Dane zapisują się w Twojej lokalnej bazie.', 'Dane zapisują się w tej przeglądarce.')
html = html.replace('<div class="toolbar-actions">', '<div class="toolbar-actions"><button id="backup-button" class="text-button">Kopia danych</button>', 1)
html = html.replace(' <section class="metrics"', '<div class="offline-note"><span><b>Działa offline, bez instalacji.</b> Otwieraj ten sam plik w tej samej przeglądarce. Regularnie pobieraj kopię danych.</span><span>● Zapis lokalny</span></div>\n <section class="metrics"', 1)
dialog = '''<dialog id="backup-dialog"><div class="dialog-heading"><div><span class="section-eyebrow">KALENDARZ I USTAWIENIA</span><h2>Twoje dane. Twoja kopia.</h2></div><button type="button" class="close-button" aria-label="Zamknij">×</button></div><p class="muted">Treningi są zapisywane w tej przeglądarce, na tym urządzeniu. Pobierz kopię przed zmianą przeglądarki, przeniesieniem pliku lub wyczyszczeniem danych przeglądania. Kopia zawiera także strefy i próbki HR.</p><div class="backup-buttons"><button type="button" id="download-backup" class="button primary">Pobierz kopię JSON</button><label>Przywróć kopię<input id="restore-backup" type="file" accept=".json,application/json"></label></div><p class="footnote">CSV służy do analizy w Excelu. Kopia JSON pozwala odtworzyć cały dziennik na innym komputerze. Przywrócenie zastępuje obecny kalendarz; zachowaj wcześniej jego kopię. Tryb prywatny przeglądarki może usuwać dane po zamknięciu okna.</p><p class="form-error" role="alert"></p></dialog>'''
html = html.replace('</body>', dialog + '\n<script>\n' + local.replace('</script', '<\\/script') + '\n</script>\n<script>\n' + app.replace('</script', '<\\/script') + '\n</script>\n</body>')
assert '{%' not in html and 'src="' not in html and 'href="/api/' not in html.replace('href="/api/export/"', '')
html_name = args.html_name or f'{args.app_name}.html'
zip_name = args.zip_name or f'{args.app_name.lower()}.zip'
if args.app_name != 'Forma':
    html = html.replace('Forma', args.app_name).replace('forma', args.app_name.lower())
    html = html.replace('TWÓJ DZIENNIK SĘDZIEGO', 'TWÓJ DZIENNIK TRENINGOWY')
    html = html.replace('MAŁE KROKI. DOBRA FORMA.', 'TRENUJ ŚWIADOMIE. BĄDŹ GOTOWY.')
    html = html.replace('Przestrzeń na dobrą formę.', 'Twój dziennik treningowy.')
output = args.output or ROOT / 'downloads'
output.mkdir(parents=True, exist_ok=True)
(output / html_name).write_text(html)
instructions = f'{args.app_name.upper()} — APLIKACJA TRENINGOWA\n\nRozpakuj ZIP i otwórz {html_name} dwuklikiem w Chrome, Edge lub Firefox.\nNie instalujesz Pythona, dodatków ani innych programów. Działa bez internetu.\n\nOtwieraj ten sam plik w tej samej przeglądarce.\nPrzycisk „Kopia danych” pozwala zapisać cały dziennik w JSON i później go odtworzyć.\nZrób kopię przed zmianą przeglądarki, przeniesieniem pliku lub usunięciem danych przeglądania.\n'
if args.app_name != 'Forma':
    instructions += f'\n{args.app_name} używa oddzielnego zapisu i zaczyna od pustego kalendarza. Stare dane nie są automatycznie przenoszone.\nZ Garmina wyeksportuj aktywność do TCX, a potem w aplikacji {args.app_name} wybierz „Importuj z Garmina” lub otwórz wpis w kalendarzu i użyj „Importuj TCX do tej aktywności”.\n'
with ZipFile(output / zip_name, 'w', ZIP_DEFLATED) as archive:
    archive.writestr(html_name, html)
    archive.writestr('Instrukcja.txt', instructions)
if args.app_name == 'Forma':
    # Keep the previously shared download URL useful for the simple version.
    (output / 'forma-dziennik-sedziego.zip').write_bytes((output / zip_name).read_bytes())
print(f'Built {html_name} ({len(html.encode())} bytes) and {zip_name}')
