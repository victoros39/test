import sqlite3
from pathlib import Path

DB_PATH = Path("theater.db")

def add_table_layout_column():
    print("🔧 Миграция: добавление поддержки столов (table_layout)...")
    
    if not DB_PATH.exists():
        print(f"❌ Ошибка: Файл '{DB_PATH}' не найден в текущей директории.")
        print("💡 Перейдите в папку проекта перед запуском: cd /путь/к/theater-booking")
        return False

    conn = sqlite3.connect(DB_PATH)
    try:
        cursor = conn.cursor()
        # Проверяем существующие колонки
        cursor.execute("PRAGMA table_info(shows);")
        columns = [row[1] for row in cursor.fetchall()]

        if "table_layout" in columns:
            print("✅ Колонка 'table_layout' уже существует. Ничего менять не нужно.")
            return True

        print("➕ Добавляю колонку 'table_layout TEXT DEFAULT \"{}\"'...")
        cursor.execute("ALTER TABLE shows ADD COLUMN table_layout TEXT DEFAULT '{}';")
        conn.commit()
        print("🎉 Успешно! Колонка добавлена. Теперь можно настраивать столы в админке.")
        return True

    except sqlite3.OperationalError as e:
        print(f"❌ Ошибка БД: {e}")
        return False
    except Exception as e:
        print(f"❌ Неожиданная ошибка: {e}")
        return False
    finally:
        conn.close()

if __name__ == "__main__":
    add_table_layout_column()