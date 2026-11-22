import os
import io
import csv
import sqlite3
import secrets
import logging
from pathlib import Path
from datetime import datetime, timedelta
from contextlib import asynccontextmanager
import qrcode
from fpdf import FPDF
from fastapi import FastAPI, Request, Query, HTTPException
from fastapi.responses import HTMLResponse, JSONResponse, Response, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

# Настройка логирования
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

def cleanup_expired_reservations():
    conn = get_db()
    try:
        # Отменяем истекшие брони
        conn.execute("UPDATE bookings SET status='cancelled' WHERE status='reserved' AND expires_at IS NOT NULL AND datetime(expires_at) < datetime('now')")
        conn.commit()
    finally:
        conn.close()

def init_db_schema():
    conn = get_db()
    try:
        # 1️⃣ Создаём таблицу привязок волонтёров
        conn.execute("""
            CREATE TABLE IF NOT EXISTS volunteer_assignments (
                volunteer_id INTEGER,
                show_id INTEGER,
                PRIMARY KEY (volunteer_id, show_id),
                FOREIGN KEY(volunteer_id) REFERENCES volunteers(id),
                FOREIGN KEY(show_id) REFERENCES shows(id)
            )
        """)
        # 2️⃣ Добавляем колонку управления бронью (если её ещё нет)
        conn.execute("ALTER TABLE shows ADD COLUMN booking_open INTEGER DEFAULT 1;")
        conn.commit()
    except Exception:
        pass  # Колонка уже существует или таблица уже создана — это нормально
    finally:
        conn.close()

@asynccontextmanager
async def lifespan(app: FastAPI):
    cleanup_expired_reservations()
    init_db_schema()
    logging.info("✅ Система бронирования готова")
    yield

app = FastAPI(title="Theater Booking System", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.mount("/static", StaticFiles(directory="static"), name="static")

DB_PATH = Path(__file__).parent / "theater.db"
BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8000")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin")

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    # ИСПРАВЛЕНИЕ: Разделили команды PRAGMA на отдельные execute
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA synchronous=NORMAL;")
    conn.execute("PRAGMA cache_size=-2000;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.row_factory = sqlite3.Row
    return conn

def qr_bytes(d: str) -> bytes:
    qr = qrcode.QRCode(box_size=10, border=2)
    qr.add_data(d)
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color="black", back_color="white").save(buf, "PNG")
    return buf.getvalue()

def gen_pdf(bk: dict, show: dict):
    img = qr_bytes(f"{BASE_URL}/api/cancel?token={bk['cancel_token']}")
    p = FPDF(orientation="P", unit="mm", format=(105, 148))
    p.add_page()
    p.set_margins(10, 10, 10)
    
    fp = "DejaVuSans.ttf"
    if not Path(fp).exists():
        raise FileNotFoundError(f"⚠️ Положите {fp} в папку с main.py")

    p.add_font("Cyr", "", fp, uni=True)

    def txt(s, sz, clr, h=5):
        p.set_font("Cyr", size=sz)
        p.set_text_color(*clr)
        p.set_x(10)
        p.multi_cell(85, h, s, align="C", new_x="LMARGIN", new_y="NEXT")
    
    p.set_y(12)
    txt("Танцующие тени", 11, (108, 92, 231), 4)
    txt(show["title"], 14, (30, 30, 30), 6)
    txt(f"{show['date']} | {show['time']}", 10, (100, 100, 100), 4)
    p.ln(2)
    
    p.set_fill_color(248, 250, 252)
    p.set_font("Cyr", size=12)
    p.set_x(10)
    p.cell(85, 8, f"Зритель: {bk['viewer_name']}", align="C", fill=True, new_x="LMARGIN", new_y="NEXT")
    p.cell(85, 7, f"Ряд: {bk['row']} | Место: {bk['seat']}", align="C", new_x="LMARGIN", new_y="NEXT")

    py = p.get_y() + 5
    p.image(io.BytesIO(img), x=32.5, y=py, w=40)

    fy = py + 45
    p.set_y(min(fy, 125))
    p.set_font("Cyr", size=6.5)
    p.set_text_color(140, 140, 140)
    p.set_x(10)
    p.multi_cell(85, 3.5, os.getenv("THEATER_CONTACT", "Контакты"), align="C")
    p.set_text_color(239, 68, 68)
    p.set_x(10)
    p.multi_cell(85, 3.5, f"Отмена:\n{BASE_URL}/api/cancel?token={bk['cancel_token']}", align="C")
    
    return p.output(), img

def vol_auth(t):
    c = get_db()
    v = c.execute("SELECT id, name, is_active FROM volunteers WHERE access_token=?", (t,)).fetchone()
    c.close()
    if not v or not v["is_active"]:
        raise HTTPException(403, "Доступ запрещён или волонтёр отключён")
    return dict(v)

def cancel_page_html(icon, title, desc, color):
    return f"""
    <div style="max-width:400px; margin:50px auto; text-align:center; font-family:system-ui; padding:20px; border-radius:10px; box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        <h1 style="font-size:3rem; margin:0;">{icon}</h1>
        <h2 style="color:{color}; margin:10px 0;">{title}</h2>
        <p style="color:#64748b;">{desc}</p>
        <a href="/" style="display:inline-block; margin-top:20px; padding:10px 20px; background:#6c5ce7; color:#fff; text-decoration:none; border-radius:6px;">Вернуться на афишу</a>
    </div>
    """

# === АДМИНКА ===
@app.post("/api/admin/login")
async def admin_login(req: Request):
    data = await req.json()
    if data.get("password") == ADMIN_PASSWORD:
        return {"ok": True}
    raise HTTPException(401, "Неверный пароль")

@app.get("/api/admin/shows")
async def admin_get_shows():
    c = get_db()
    res = [dict(x) for x in c.execute("SELECT id, title, date, time, status, poster, description, layout_rows, layout_cols, aisle_after_col, booking_open FROM shows ORDER BY date, time").fetchall()]
    c.close()
    return res

@app.get("/api/admin/shows/{id}/bookings")
async def admin_get_bookings(id: int):
    c = get_db()
    res = [dict(x) for x in c.execute("SELECT * FROM bookings WHERE show_id=? ORDER BY row, seat", (id,)).fetchall()]
    c.close()
    return res

# 🔑 Новый эндпоинт для архивации/восстановления спектакля
@app.patch("/api/admin/shows/{id}/status")
async def admin_toggle_show_status(id: int, req: Request):
    data = await req.json()
    new_status = data.get("status")
    if new_status not in ("active", "archived"):
        raise HTTPException(400, "Недопустимый статус")
    c = get_db()
    c.execute("UPDATE shows SET status=? WHERE id=?", (new_status, id))
    c.commit()
    c.close()
    return {"ok": True}

@app.post("/api/admin/shows")
async def admin_create_show(req: Request):
    data = await req.json()
    c = get_db()
    try:
        c.execute("""
            INSERT INTO shows (
                title, description, date, time, poster,
                layout_rows, layout_cols, aisle_after_col,
                status, booking_open
            ) VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            data.get("title"),
            data.get("description"),
            data.get("date"),
            data.get("time"),
            data.get("poster"),
            int(data.get("rows", 10)),
            int(data.get("cols", 10)),
            data.get("aisle_after_col", "0"),
            "active",
            1
        ))
        c.commit()
        return {"ok": True}
    finally:
        c.close()

@app.post("/api/admin/bookings/{id}/cancel")
async def admin_cancel_booking(id: int):
    c = get_db()
    c.execute("UPDATE bookings SET status='cancelled' WHERE id=?", (id,))
    c.commit()
    c.close()
    return {"ok": True}

@app.patch("/api/admin/bookings/{id}/status")
async def admin_force_status(id: int, req: Request):
    data = await req.json()
    new_status = data.get("status")
    if new_status not in ("reserved", "cancelled", "verified"):
        raise HTTPException(400, "Недопустимый статус")
    c = get_db()
    c.execute("UPDATE bookings SET status=? WHERE id=?", (new_status, id))
    c.commit()
    c.close()
    return {"message": f"Статус изменён на {new_status}"}

@app.get("/api/admin/volunteers")
async def admin_get_vols():
    c = get_db()
    res = [dict(x) for x in c.execute("SELECT id, name, access_token, is_active, created_at FROM volunteers ORDER BY created_at DESC").fetchall()]
    c.close()
    return res

@app.post("/api/admin/volunteers")
async def admin_create_vol(req: Request):
    data = await req.json()
    c = get_db()
    c.execute("INSERT INTO volunteers(name, access_token) VALUES (?, ?)", (data.get("name"), secrets.token_urlsafe(32)))
    c.commit()
    c.close()
    return {"ok": True}

@app.patch("/api/admin/volunteers/{id}/status")
async def admin_toggle_vol_status(id: int, req: Request):
    data = await req.json()
    c = get_db()
    c.execute("UPDATE volunteers SET is_active=? WHERE id=?", (int(data.get("is_active", True)), id))
    c.commit()
    c.close()
    return {"ok": True}

# Получить список спектаклей, назначенных волонтеру
@app.get("/api/admin/volunteers/{id}/assignments")
async def get_vol_assignments(id: int):
    c = get_db()
    rows = c.execute("SELECT show_id FROM volunteer_assignments WHERE volunteer_id=?", (id,)).fetchall()
    c.close()
    return [r["show_id"] for r in rows]

@app.post("/api/admin/volunteers/{id}/assignments")
async def save_vol_assignments(id: int, req: Request):
    data = await req.json()
    show_ids = data.get("show_ids", [])
    c = get_db()
    c.execute("DELETE FROM volunteer_assignments WHERE volunteer_id=?", (id,))
    for sid in show_ids:
        c.execute("INSERT INTO volunteer_assignments VALUES (?,?)", (id, sid))
    c.commit()
    c.close()
    return {"ok": True}

@app.patch("/api/admin/shows/{id}")
async def admin_update_show(id: int, req: Request):
    data = await req.json()
    c = get_db()
    if not c.execute("SELECT 1 FROM shows WHERE id=?", (id,)).fetchone():
        c.close()
        raise HTTPException(404, "Спектакль не найден")
    
    updates, params = [], []
    for key, val in data.items():
        if key == "rows":
            updates.append("layout_rows=?")
        elif key == "cols":
            updates.append("layout_cols=?")
        elif key in ("title", "description", "date", "time", "status", "poster", "aisle_after_col"):
            updates.append(f"{key}=?")
        params.append(val)
    
    if updates:
        params.append(id)
        c.execute(f"UPDATE shows SET {', '.join(updates)} WHERE id=?", params)
        c.commit()
    c.close()
    return {"ok": True}

@app.patch("/api/admin/shows/{id}/booking-status")
async def toggle_booking_status(id: int, req: Request):
    data = await req.json()
    c = get_db()
    c.execute("UPDATE shows SET booking_open=? WHERE id=?", (int(data.get("open", True)), id))
    c.commit()
    c.close()
    return {"ok": True}

@app.delete("/api/admin/shows/{id}")
async def del_show(id: int):
    c = get_db()
    try:
        c.execute("DELETE FROM bookings WHERE show_id=?", (id,))
        r = c.execute("DELETE FROM shows WHERE id=?", (id,))
        c.commit()
        if r.rowcount == 0:
            raise HTTPException(status_code=404, detail="Спектакль не найден")
        return {"ok": True}
    finally:
        c.close()

@app.get("/api/admin/shows/{id}/export")
async def export_csv(id: int):
    c = get_db()
    rows = [dict(x) for x in c.execute("SELECT row, seat, viewer_name, contact, status, created_at FROM bookings WHERE show_id=? ORDER BY row, seat", (id,)).fetchall()]
    c.close()
    
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["Ряд", "Место", "Имя", "Контакт", "Статус", "Дата создания"])
    for b in rows:
        w.writerow([b['row'], b['seat'], b['viewer_name'] or '', b['contact'] or '', b['status'], b['created_at']])
    
    return Response(content=out.getvalue().encode('utf-8-sig'), media_type="text/csv", headers={"Content-Disposition": f"attachment; filename=bookings_{id}.csv"})

@app.post("/api/admin/bookings/{id}/resend")
async def resend_ticket(id: int):
    return {"message": "📧 Отправлено (тестовый режим)"}

# === КЛИЕНТ ===
@app.get("/api/shows")
async def client_get_shows():
    c = get_db()
    res = [dict(x) for x in c.execute("SELECT id, title, date, time, poster, description FROM shows WHERE status='active' ORDER BY date, time").fetchall()]
    c.close()
    return res

@app.get("/api/shows/{id}/layout")
async def client_get_layout(id: int):
    cleanup_expired_reservations()
    c = get_db()
    s = c.execute("SELECT title, layout_rows, layout_cols, aisle_after_col, booking_open FROM shows WHERE id=?", (id,)).fetchone()
    if not s:
        c.close()
        raise HTTPException(404, "Спектакль не найден")
    
    booked = {f"{r['row']},{r['seat']}": r['status'] for r in c.execute(
        "SELECT row, seat, status FROM bookings WHERE show_id=? AND status!='cancelled' AND (status!='reserved' OR datetime(expires_at) > datetime('now'))", (id,)
    ).fetchall()}
    c.close()
    
    return {
        "title": s["title"], 
        "rows": s["layout_rows"], 
        "cols": s["layout_cols"], 
        "aisle_after_col": s["aisle_after_col"], 
        "booking_open": bool(s["booking_open"]), 
        "booked": booked
    }

@app.post("/api/book")
async def book_seat(req: Request):
    cleanup_expired_reservations()
    data = await req.json()
    c = get_db()
    
    if not all([data.get("show_id"), data.get("row"), data.get("seat")]):
        c.close()
        raise HTTPException(400, "Укажите show_id, row и seat")
    
    show = c.execute("SELECT booking_open FROM shows WHERE id=?", (data["show_id"],)).fetchone()
    if not show or not show["booking_open"]:
        c.close()
        raise HTTPException(403, "Бронирование приостановлено администратором")
    
    if c.execute("SELECT 1 FROM bookings WHERE show_id=? AND row=? AND seat=? AND status NOT IN ('cancelled','expired') AND (status!='reserved' OR datetime(expires_at) > datetime('now'))", 
                 (data["show_id"], data["row"], data["seat"])).fetchone():
        c.close()
        raise HTTPException(409, "Место занято")
    
    token = secrets.token_urlsafe(16)
    expires = (datetime.now() + timedelta(minutes=30)).strftime("%Y-%m-%d %H:%M:%S")
    r = c.execute("INSERT INTO bookings(show_id, row, seat, viewer_name, contact, consent, cancel_token, status, expires_at) VALUES (?,?,?,?,?,?,?,?,?)", 
                  (data["show_id"], data["row"], data["seat"], data.get("name", ""), data.get("contact", ""), int(data.get("consent", False)), token, "reserved", expires))
    c.commit()
    bid = r.lastrowid
    c.close()
    return {"token": token, "expires_at": expires, "booking_id": bid}

@app.get("/api/cancel", response_class=HTMLResponse)
async def cancel_booking(token: str = Query(...)):
    token = token.strip()
    c = get_db()
    try:
        b = c.execute("SELECT id, status FROM bookings WHERE cancel_token=?", (token,)).fetchone()
        if not b:
            return HTMLResponse(cancel_page_html("❌", "Бронь не найдена", "Ссылка обрезана или неверна.", "#ef4444"), status_code=404)
        if b["status"] == "cancelled":
            return HTMLResponse(cancel_page_html("🚫", "Уже отменена", "Эта бронь была отменена ранее.", "#f59e0b"), status_code=409)
        if b["status"] == "verified":
            return HTMLResponse(cancel_page_html("🔒", "Билет использован", "Зритель уже прошёл в зал.", "#64748b"), status_code=403)
        
        c.execute("UPDATE bookings SET status='cancelled' WHERE cancel_token=?", (token,))
        c.commit()
        return HTMLResponse(cancel_page_html("✅", "Бронь успешно отменена", "Место освобождено.", "#10b981"), status_code=200)
    finally:
        c.close()

@app.get("/api/bookings/{id}/pdf")
async def download_pdf(id: int):
    cleanup_expired_reservations()
    c = get_db()
    b = c.execute("SELECT * FROM bookings WHERE id=?", (id,)).fetchone()
    if not b:
        c.close()
        raise HTTPException(404, "Бронь не найдена")
    s = c.execute("SELECT * FROM shows WHERE id=?", (b["show_id"],)).fetchone()
    c.close()
    if not s:
        raise HTTPException(404, "Спектакль не найден")
    
    return Response(content=bytes(gen_pdf(dict(b), dict(s))[0]), media_type="application/pdf", headers={"Content-Disposition": f"attachment; filename=ticket_{id}.pdf"})

# === ВОЛОНТЁР ===
@app.get("/volunteer", response_class=HTMLResponse)
async def volunteer_page():
    return FileResponse("volunteer.html")

@app.get("/api/vol/check")
async def vol_check(token: str = Query(...)):
    v = vol_auth(token)
    return {"name": v["name"], "id": v["id"]}

# ОБНОВЛЕННЫЙ ЭНДПОИНТ: Волонтер видит только свои спектакли (если есть привязки)
@app.get("/api/vol/shows")
async def vol_shows(token: str = Query(...)):
    vol = vol_auth(token)
    c = get_db()
    assigned = [x["show_id"] for x in c.execute("SELECT show_id FROM volunteer_assignments WHERE volunteer_id=?", (vol["id"],)).fetchall()]
    
    if assigned:
        query = "SELECT id, title, date, time FROM shows WHERE id IN ({}) AND status='active' ORDER BY date, time".format(','.join(['?']*len(assigned)))
        res = [dict(x) for x in c.execute(query, assigned).fetchall()]
    else:
        res = [dict(x) for x in c.execute("SELECT id, title, date, time FROM shows WHERE status='active' ORDER BY date, time").fetchall()]
    
    c.close()
    return res

@app.get("/api/vol/bookings/{sid}")
async def vol_bookings(sid: int, token: str = Query(...)):
    vol_auth(token)
    c = get_db()
    s = c.execute("SELECT id, title, layout_rows, layout_cols, aisle_after_col FROM shows WHERE id=?", (sid,)).fetchone()
    bk = [dict(x) for x in c.execute("SELECT id, row, seat, viewer_name, contact, status, cancel_token FROM bookings WHERE show_id=?", (sid,)).fetchall()]
    c.close()
    return {"show": dict(s), "bookings": bk}

@app.post("/api/vol/verify")
async def vol_verify(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    b = c.execute("SELECT id, row, seat, viewer_name, contact, status FROM bookings WHERE cancel_token=?", (data.get("token"),)).fetchone()
    
    if not b:
        c.close()
        raise HTTPException(404, "Билет не найден")
    if b["status"] == "cancelled":
        c.close()
        raise HTTPException(400, "Бронь отменена")
    if b["status"] == "verified":
        c.close()
        return JSONResponse({"status": "already", "message": "Уже проверен", "row": b["row"], "col": b["seat"]}, status_code=409)
    
    c.execute("UPDATE bookings SET status='verified' WHERE id=?", (b["id"],))
    c.commit()
    c.close()
    return {"status": "ok", "row": b["row"], "col": b["seat"], "name": b["viewer_name"]}

@app.post("/api/vol/move")
async def vol_move(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    
    if c.execute("SELECT 1 FROM bookings WHERE show_id=(SELECT show_id FROM bookings WHERE id=?) AND row=? AND seat=? AND status!='cancelled'",
                 (data["booking_id"], data["new_row"], data["new_col"])).fetchone():
        c.close()
        raise HTTPException(409, "Новое место занято")
    
    c.execute("UPDATE bookings SET row=?, seat=? WHERE id=?", (data["new_row"], data["new_col"], data["booking_id"]))
    c.commit()
    c.close()
    return {"ok": True}

@app.post("/api/vol/update")
async def vol_update(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    c.execute("UPDATE bookings SET status=?, viewer_name=?, contact=? WHERE id=?",
              (data.get("status"), data.get("name", ""), data.get("contact", ""), data["booking_id"]))
    c.commit()
    c.close()
    return {"ok": True}

@app.post("/api/vol/cancel")
async def vol_cancel(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    r = c.execute("UPDATE bookings SET status='cancelled' WHERE id=?", (int(data["booking_id"]),))
    c.commit()
    c.close()
    if r.rowcount == 0:
        raise HTTPException(404, "Бронь не найдена")
    return {"ok": True}

@app.post("/api/vol/book")
async def vol_book_walkin(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    
    occ = c.execute("SELECT id, status, viewer_name, expires_at FROM bookings WHERE show_id=? AND row=? AND seat=? AND status!='cancelled'",
                    (data["show_id"], data["row"], data["col"])).fetchone()
    
    if occ:
        if occ["status"] == "reserved" and occ["expires_at"] and datetime.fromisoformat(occ["expires_at"]) < datetime.now():
            c.execute("UPDATE bookings SET status='cancelled' WHERE id=?", (occ["id"],))
            c.commit()
            occ = None
        if occ:
            c.close()
            raise HTTPException(409, f"Место занято ({occ['viewer_name'] or 'неизв.'})")
    
    t = secrets.token_urlsafe(12)
    r = c.execute("INSERT INTO bookings(show_id, row, seat, viewer_name, contact, consent, status, cancel_token) VALUES (?,?,?,?,?,1,'verified',?)",
                  (data["show_id"], data["row"], data["col"], data["name"], data.get("contact", ""), t))
    c.commit()
    bid = r.lastrowid
    b = c.execute("SELECT id, row, seat, viewer_name, contact, status FROM bookings WHERE id=?", (bid,)).fetchone()
    c.close()
    return {"message": "Ок", "booking": dict(b)}

@app.post("/api/vol/book-group")
async def vol_book_group(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    
    if len(data.get("seats", [])) > 10:
        raise HTTPException(400, "Максимум 10 мест за раз")
    
    try:
        c.execute("BEGIN IMMEDIATE")
        occ = []
        
        for s in data["seats"]:
            o = c.execute("SELECT id, status, expires_at FROM bookings WHERE show_id=? AND row=? AND seat=? AND status!='cancelled'",
                          (data["show_id"], s["row"], s["col"])).fetchone()
            if o and o["status"] == "reserved" and o["expires_at"] and datetime.fromisoformat(o["expires_at"]) < datetime.now():
                c.execute("UPDATE bookings SET status='cancelled' WHERE id=?", (o["id"],))
                c.commit()
                o = None
            if o:
                occ.append(f"{s['row']},{s['col']}")
        
        if occ:
            raise HTTPException(409, f"Занято: {', '.join(occ)}")
        
        r = []
        for s in data["seats"]:
            t = secrets.token_urlsafe(12)
            c.execute("INSERT INTO bookings(show_id, row, seat, viewer_name, contact, consent, status, cancel_token) VALUES (?,?,?,?,?,1,'verified',?)",
                      (data["show_id"], s["row"], s["col"], data["name"], data.get("contact", ""), t))
            b = c.execute("SELECT id, row, seat, viewer_name, contact, status FROM bookings WHERE show_id=? AND row=? AND seat=?",
                          (data["show_id"], s["row"], s["col"])).fetchone()
            if b:
                r.append(dict(b))
        
        c.commit()
        c.close()
        return {"message": f"✅ {len(r)} мест забронировано", "bookings": r}
        
    except HTTPException:
        c.rollback()
        c.close()
        raise
    except Exception as e:
        c.rollback()
        c.close()
        raise HTTPException(500, str(e))

@app.post("/api/vol/sync")
async def vol_sync(token: str = Query(...), req: Request = None):
    vol_auth(token)
    data = await req.json()
    c = get_db()
    res = []
    
    for a in data.get("queue", []):
        try:
            p = a["payload"]
            if a["type"] == "verify":
                c.execute("UPDATE bookings SET status='verified' WHERE cancel_token=?", (p["token"],))
            elif a["type"] == "move":
                c.execute("UPDATE bookings SET row=?, seat=? WHERE id=?", (p["new_row"], p["new_col"], p["booking_id"]))
            elif a["type"] == "update":
                c.execute("UPDATE bookings SET viewer_name=?, contact=? WHERE id=?", (p["name"], p["contact"], p["booking_id"]))
            elif a["type"] == "cancel":
                c.execute("UPDATE bookings SET status='cancelled' WHERE id=?", (p["booking_id"],))
            c.commit()
            res.append({"ok": True})
        except Exception:
            res.append({"ok": False})
    
    c.close()
    return {"results": res}

@app.get("/", response_class=HTMLResponse)
async def index():
    return FileResponse("index.html")

@app.get("/admin", response_class=HTMLResponse)
async def admin_page():
    return FileResponse("admin.html")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=True)