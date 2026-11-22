import sqlite3
from pathlib import Path

DB_PATH = Path("theater.db")
conn = sqlite3.connect(DB_PATH)
try:
    # Добавляем колонку, если её нет
    conn.execute("ALTER TABLE shows ADD COLUMN venue_address TEXT DEFAULT '';")
    conn.commit()
    print("✅ Колонка venue_address добавлена")
except sqlite3.OperationalError as e:
    if "duplicate column name" in str(e):
        print("ℹ️ Колонка уже существует")
    else:
        raise
finally:
    conn.close()