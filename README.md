# Forma — dziennik treningowy sędziego

Aplikacja do planowania treningów, meczów i regeneracji oraz analizy plików Garmin TCX. **Najprostsza wersja to jeden plik HTML: działa offline w przeglądarce, bez Pythona, instalowania dodatków i uruchamiania serwera.** Interfejs jest po polsku i dostosowuje się do telefonu.

## Uruchomienie bez instalacji

1. [Pobierz prostą aplikację ZIP](https://github.com/Saken121/my-first-blog/raw/refs/heads/forma-download/downloads/forma-prosta.zip).
2. Rozpakuj ZIP i otwórz **Forma.html** dwuklikiem w Chrome, Edge lub Firefox.
3. Planuj i importuj TCX. Po pobraniu aplikacja działa bez internetu.

Wszystkie style i funkcje są w tym jednym pliku. Nie potrzebujesz dodatkowych plików ani konta. Dane są zapisywane w tej przeglądarce, na tym urządzeniu. Otwieraj ten sam plik w tej samej przeglądarce. Przyciskiem **Kopia danych** pobierz pełny dziennik w JSON; można go potem przywrócić na innym komputerze. Zrób kopię przed przeniesieniem pliku, zmianą przeglądarki lub wyczyszczeniem danych przeglądania. Tryb prywatny może usuwać dane po zamknięciu okna.

## Opcjonalna wersja serwerowa Django

Poniższe polecenia dotyczą alternatywnej wersji serwerowej. Nie są potrzebne do otwarcia `Forma.html`.

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
2. Wybierz rodzaj, m.in. bieg spokojny lub regeneracyjny, rozciąganie regeneracyjne, starty, krótkie sprinty, szybkie lub tempowe interwały, siłę i mobilność. Mecze mają osobne kategorie: **III liga, liga okręgowa i sędzia asystent**.
3. Wpisz czas, dystans, cel treningu i notatki. Rozróżniaj aktywności zaplanowane i wykonane. Po treningu uzupełnij **RPE 1–10**.
4. W widoku **Mikrocykle** wybierz dzień. Zobaczysz propozycje tygodnia wokół terminów meczów. `MD` to dzień meczowy, `MD−1` to przeddzień, `MD+1` to dzień po meczu. Kliknięcie propozycji otwiera edytowalny formularz planu. Uwzględniane są również mecze w sąsiednich miesiącach. Przy bliskich terminach pierwszeństwo ma regeneracja po ostatnim meczu.
5. W widoku **Analiza treningów** sprawdzaj czas w strefach, tętno i obciążenie. **Więcej analiz** rozbija bieganie na typy sesji, pokazuje kilometraż z 12 tygodni i trendy prędkości 5/30 s, najlepszego kilometra oraz mocy 5 s. Filtruj wykresy według rodzaju treningu. Podsumowanie rozdziela kilometry biegowe z meczów i treningów oraz podaje ich sumę. **Eksport CSV** zapisuje wybrany miesiąc w pliku czytelnym dla Excela, z separatorem `;` i kodowaniem UTF-8.

Propozycje mikrocykli są punktem wyjścia do własnego planu. Nie przesuwają ani nie zmieniają wcześniej zapisanych aktywności.

## Garmin TCX

W Garmin Connect otwórz trening i wybierz eksport do TCX. W aplikacji wybierz **Importuj z Garmina** i wskaż plik do 10 MB, zawierający jedną aktywność.

- Importuje czas, dystans, tętno średnie/maksymalne i moc średnią/maksymalną, jeśli plik zawiera te dane.
- Data pochodzi z TCX i jest przeliczana na `Europe/Warsaw`. Możesz wskazać inną datę przy imporcie.
- Nowy import zajmuje pierwsze wolne miejsce. Aby uzupełnić zaplanowany trening, otwórz go z kalendarza i wybierz **Importuj TCX do tej aktywności**. Czas, dystans, tętno i dostępne dane mocy wypełnią ten wpis; jego data, kategoria, RPE i notatki pozostaną zachowane. Dotyczy to także meczu, więc jego dystans będzie wykazany w statystyce meczowej.
- W **Analizie odcinków** zobaczysz okrążenia zapisane w Garminie albo automatyczne odcinki kilometrowe, jeśli TCX zawiera próbki GPS. Do szczytowej prędkości używamy średniej z 5 s, a moc pokazujemy jako średnią z 5 s, aby pojedyncza próbka nie wyznaczała rekordu.
- Sprint to prędkość GPS ≥25 km/h utrzymana przez co najmniej 2 s; krótkie przerwy do 2 s łączymy. Przy próbkach rzadszych niż co 3 s wynik jest oznaczany jako niedostępny, a nie jako zero sprintów.
- Trendy obejmują importowane treningi biegowe z ostatnich 12 tygodni. Starsze importy nie zawierają obliczonych odcinków, szczytów ani sprintów; jeśli chcesz je uwzględnić, dołącz ponownie ich pliki TCX.
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

W prostej aplikacji używaj **Kopia danych → Pobierz kopię JSON**. Przywrócenie JSON odtwarza kalendarz, ustawienia stref i próbki HR; zastępuje obecny dziennik po potwierdzeniu. CSV jest zestawieniem do analizy, a nie pełną kopią danych. Program służy do osobistego użycia, bez kont użytkowników. W opcjonalnej wersji Django kopię stanowi plik `db.sqlite3`, kopiowany przy zatrzymanym serwerze.

```bash
.venv/bin/python manage.py check
.venv/bin/python manage.py test training --noinput
.venv/bin/python manage.py makemigrations --check --dry-run
```

Testy obejmują import, próbki HR/mocy, zmianę stref, limity kalendarza, edycję, usuwanie, mikrocykle, ochronę CSRF i eksport. Stary blog z repozytorium nadal znajduje się pod ścieżką `/blog/`.

### Budowanie i sprawdzanie prostej aplikacji

Polecenia dla programisty (użytkownik gotowego HTML nie potrzebuje tych narzędzi):

```bash
python3 tools/build_standalone.py
node tools/test_standalone.cjs
```

Budowanie używa wyłącznie standardowej biblioteki Pythona. Testy korzystają z Playwright i Chromium dostępnych w środowisku chmurowym. `FORMA_HTML` wskazuje inny plik do sprawdzenia, a `FORMA_CHROMIUM` inną lokalizację przeglądarki. Opcja `--output /tmp/forma-build` pozwala budować poza repozytorium. Testy sprawdzają m.in. import TCX, strefy, limity dwóch aktywności, mikrocykle, trwały zapis, kopie JSON i eksport CSV przy wyłączonej sieci. Gdy zarządzana przeglądarka blokuje `file://`, test używa identycznego HTML w lokalnym źródle obsłużonym z pamięci, bez zmiany zasad przeglądarki.
