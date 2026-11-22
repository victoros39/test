# fix_expired.py
import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).parent / "theater.db"
conn = sqlite3.connect(DB_PATH)
# Конвертируем все expired в cancelled
cur = conn.execute("UPDATE bookings SET status='cancelled' WHERE status='expired'")
print(f"✅ Конвертировано записей: {cur.rowcount}")
# Удаляем просроченные резервы
cur = conn.execute("""
  UPDATE bookings SET status='cancelled' 
  WHERE status='reserved' AND expires_at IS NOT NULL 
  AND datetime(expires_at) < datetime('now')
""")
print(f"✅ Отменено просроченных резервов: {cur.rowcount}")
conn.commit()
conn.close()
print("🎉 Готово! Запустите сервер заново.")