import sqlite3
from pathlib import Path

DB_PATH = Path("theater.db")

def add_vol_verification_column():
    if not DB_PATH.exists():
        print(f"❌ Файл {DB_PATH} не найден. Запускайте скрипт из папки проекта.")
        return

    conn = sqlite3.connect(DB_PATH)
    try:
        conn.execute("ALTER TABLE bookings ADD COLUMN verified_by_volunteer_id INTEGER DEFAULT NULL;")
        conn.commit()
        print("✅ Колонка 'verified_by_volunteer_id' успешно добавлена.")
    except sqlite3.OperationalError as e:
        if "duplicate column name" in str(e).lower():
            print("ℹ️ Колонка уже существует. Ничего делать не нужно.")
        else:
            print(f"❌ Ошибка БД: {e}")
    finally:
        conn.close()

if __name__ == "__main__":
    print("🔧 Миграция: учёт статистики волонтёров...")
    add_vol_verification_column()
    print("🏁 Готово.")