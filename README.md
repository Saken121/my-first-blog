# Forma — dziennik treningowy sędziego

Aplikacja do planowania treningów, meczów i regeneracji oraz analizy plików Garmin TCX. Działa w przeglądarce i zapisuje dane w lokalnej bazie SQLite (`db.sqlite3`). Interfejs jest po polsku i dostosowuje się do telefonu.

## Uruchomienie

Potrzebujesz **Pythona 3.12 lub nowszego** i dostępu do PyPI podczas pierwszej instalacji.

- Linux / macOS: w katalogu programu uruchom `bash run.sh`.
- Windows: zainstaluj Python 3.12 z python.org i uruchom `run.bat`.
- Skrypt przygotuje środowisko, zainstaluje przypięte zależności z weryfikacją sum kontrolnych, wykona migracje i uruchomi serwer. Otwórz w przeglądarce adres lokalny wypisany przez Django. Zatrzymanie: `Ctrl+C` w terminalu.

Ręcznie:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install --require-hashes --only-binary=:all: -r requirements.lock
.venv/bin/python manage.py migrate --noinput
.venv/bin/python manage.py runserver 127.0.0.1:8000 --noreload
```

W przygotowanym środowisku chmurowym interpreter znajduje się w `/workspace/.onboarding/my-first-blog/venv/bin/python`. Użyj zapisanych instrukcji `start_skill`. Serwer działa lokalnie; konfiguracja nie udostępnia go publicznie.

## Codzienna praca

1. Wybierz miesiąc i kliknij jedno z **dwóch miejsc aktywności** w danym dniu.
2. Wybierz rodzaj: bieg spokojny, interwały, szybkość, siła, mobilność, regeneracja, rower, test lub inna aktywność. Mecze mają osobne kategorie: **III liga, liga okręgowa i sędzia asystent**.
3. Wpisz czas, dystans, cel treningu i notatki. Rozróżniaj aktywności zaplanowane i wykonane. Po treningu uzupełnij **RPE 1–10**.
4. W widoku **Mikrocykle** wybierz dzień. Zobaczysz propozycje tygodnia wokół terminów meczów. `MD` to dzień meczowy, `MD−1` to przeddzień, `MD+1` to dzień po meczu. Kliknięcie propozycji otwiera edytowalny formularz planu. Uwzględniane są również mecze w sąsiednich miesiącach. Przy bliskich terminach pierwszeństwo ma regeneracja po ostatnim meczu.
5. W widoku **Analiza treningów** sprawdzaj czas, dystans, czas w strefach, rodzaje treningów, tętno oraz tygodniowe obciążenie. **Eksport CSV** zapisuje wybrany miesiąc w pliku czytelnym dla Excela, z separatorem `;` i kodowaniem UTF-8.

Propozycje mikrocykli są punktem wyjścia do własnego planu. Nie przesuwają ani nie zmieniają wcześniej zapisanych aktywności.

## Garmin TCX

W Garmin Connect otwórz trening i wybierz eksport do TCX. W aplikacji wybierz **Importuj z Garmina** i wskaż plik do 10 MB, zawierający jedną aktywność.

- Importuje czas, dystans, tętno średnie/maksymalne i moc średnią/maksymalną, jeśli plik zawiera te dane.
- Data pochodzi z TCX i jest przeliczana na `Europe/Warsaw`. Możesz wskazać inną datę przy imporcie.
- Nowy import zajmuje pierwsze wolne miejsce. Gdy oba miejsca są zajęte, otwórz istniejącą aktywność i wybierz **Dołącz TCX**. Zachowa datę, kategorię meczu, RPE i notatki.
- Czas w strefach liczony jest z odstępów między kolejnymi próbkami w obrębie każdego odcinka `Track`. Poprzednia próbka opisuje następujący po niej odcinek. Przerwy ponad 120 sekund i odcinki bez tętna pozostają bez danych HR. Czas próbek jest ograniczony do łącznego czasu z okrążeń.
- Brakujące próbki nie są zastępowane średnim tętnem. Ręczne aktywności nie mają automatycznie wyliczanego czasu w strefach.
- Zmiana stref przelicza zachowane próbki. Czas, dystans i HR importu są tylko do odczytu; poprawione dane można wczytać ponownie.
- Moc może być nieobecna w TCX, nawet jeśli Garmin pokazuje ją w Connect. Program nie uzupełnia jej domyślną wartością.

## Twoje parametry i strefy

Wpisane wartości: **HRmax 199 bpm, LT 177 bpm, tętno spoczynkowe 57 bpm, próg mocy biegowej 411 W**.

Domyślne strefy biegowe są oparte na progu LT według [Joe Friela / TrainingPeaks](https://www.trainingpeaks.com/blog/joe-friel-s-quick-guide-to-setting-zones/). Publikacja wyróżnia Z1 <85%, Z2 85–89%, Z3 90–94%, Z4 95–99% oraz Z5a–c od 100% LT. Program stosuje ciągłe przedziały z granicami 85/90/95/100% LT i łączy Z5a–c w jedną Z5. Dla całkowitych wartości bpm granica górna to `ceil(LT × procent) − 1`.

| Strefa | Zakres dla LT 177 bpm |
|---|---|
| Z1 — regeneracja | do 150 bpm |
| Z2 — wytrzymałość tlenowa | 151–159 bpm |
| Z3 — tempo | 160–168 bpm |
| Z4 — próg | 169–176 bpm |
| Z5 — powyżej progu | od 177 bpm |

W **Strefach tętna** możesz zmienić parametry i każdą granicę, także zgodnie z ustawieniami Garmina lub wynikami badania. HRmax i tętno spoczynkowe są zapisanymi parametrami profilu; ta metoda stref wykorzystuje LT. Próg 411 W służy jako odniesienie procentowe dla importowanej mocy biegowej.

**sRPE = czas aktywności w minutach × RPE.** W podsumowaniach brane są pod uwagę tylko wykonane aktywności. Brak RPE jest jawnie oznaczony i nie jest zastępowany zerowym wysiłkiem. Tygodnie na granicy miesiąca pokazują wyłącznie aktywności z wybranego miesiąca.

## Dane i testy

Kopiuj `db.sqlite3`, gdy serwer jest zatrzymany, aby zachować pełną kopię danych. CSV jest eksportem zestawienia i nie zastępuje kopii bazy. Program jest przygotowany do osobistego użycia lokalnego, bez kont użytkowników.

```bash
.venv/bin/python manage.py check
.venv/bin/python manage.py test training --noinput
.venv/bin/python manage.py makemigrations --check --dry-run
```

Testy obejmują import, próbki HR/mocy, zmianę stref, limity kalendarza, edycję, usuwanie, mikrocykle, ochronę CSRF i eksport. Stary blog z repozytorium nadal znajduje się pod ścieżką `/blog/`.
