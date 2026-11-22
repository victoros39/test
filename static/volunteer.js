const API = '/api';
let volToken = '', currentShowId = null, layout = { rows: 0, cols: 0, aisle: '0' };
let bookingsCache = [], selectedBooking = null, scanner = null;
let groupMode = false, groupSeats = [];
const SCANNER_COOLDOWN = 4000;
let lastScanned = { token: '', time: 0 };

function playBeep(t) {
    try {
        const c = new (window.AudioContext || window.webkitAudioContext)(), o = c.createOscillator(), g = c.createGain();
        o.connect(g); g.connect(c.destination);
        if (t === 'success') { o.frequency.value = 880; g.gain.value = 0.3; o.start(); o.stop(c.currentTime + 0.15); if (navigator.vibrate) navigator.vibrate([50, 50, 50]); }
        else if (t === 'warn') { o.frequency.value = 440; o.frequency.linearRampToValueAtTime(220, c.currentTime + 0.3); g.gain.value = 0.4; o.start(); o.stop(c.currentTime + 0.3); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
    } catch (e) {}
}

async function loginVol() {
    const t = document.getElementById('vol-token').value.trim() || new URLSearchParams(window.location.search).get('token');
    if (!t) return document.getElementById('login-error').textContent = 'Укажите токен';
    try {
        const r = await fetch(`${API}/vol/check?token=${t}`);
        if (!r.ok) throw new Error('Неверный токен');
        const d = await r.json();
        volToken = t;
        sessionStorage.setItem('vol_token', t);
        document.getElementById('vol-name').textContent = `Волонтёр: ${d.name || 'Гость'}`;
        document.getElementById('login-screen').classList.remove('active');
        document.getElementById('app-screen').classList.add('active');
        loadShows(); setupOfflineSync(); setupAutocomplete();
    } catch (e) { document.getElementById('login-error').textContent = e.message; }
}

// 🔑 ЗАГРУЗКА И ЗАПОЛНЕНИЕ СПИСКА СПЕКТАКЛЕЙ
async function loadShows() { 
    try {
        const s = await fetch(`${API}/vol/shows?token=${volToken}`).then(r => r.json()); 
        const sel = document.getElementById('show-select');
        if (sel) {
            if (s.length === 0) { 
                sel.innerHTML = '<option value="">Нет доступных спектаклей</option>'; 
            } else {
                sel.innerHTML = s.map(show => `<option value="${show.id}">${show.title} (${show.date})</option>`).join('');
                currentShowId = s[0].id;
                sel.value = currentShowId;
                loadShowData();
            }
        }
    } catch(e) { console.error('Ошибка загрузки спектаклей:', e); } 
}

async function loadShowData() {
    if (!currentShowId) return;
    try {
        const r = await fetch(`${API}/vol/bookings/${currentShowId}?token=${volToken}&_t=${Date.now()}`, { cache: 'no-store' });
        const d = await r.json();
        layout = { rows: d.show.layout_rows, cols: d.show.layout_cols, aisle: d.show.aisle_after_col };
        
        // 🔑 САНТИЗАЦИЯ: гарантируем строковый статус и числовые координаты
        bookingsCache = (d.bookings || []).map(b => ({
            ...b,
            status: String(b.status || 'free').toLowerCase(),
            row: Number(b.row),
            seat: Number(b.seat)
        }));
        
        renderGrid();
        flushQueue();
    } catch (e) { console.error('Ошибка загрузки зала:', e); }
}

window.addEventListener('focus', () => { if (volToken && currentShowId) loadShowData(); });

document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-wrapper')) {
        const b = document.getElementById('autocomplete-box');
        if (b && b.style.display === 'block') b.style.display = 'none';
        const i = document.getElementById('search-input');
        if (i && i.value.length > 0) { i.value = ''; i.dispatchEvent(new Event('input')); }
    }
    if (groupMode && !e.target.closest('.seat') && !e.target.closest('.controls') && !e.target.closest('.group-panel') && !e.target.closest('.modal')) toggleGroupMode();
});

function setupAutocomplete() {
    const i = document.getElementById('search-input'), b = document.getElementById('autocomplete-box'), c = document.querySelector('.clear-search');
    i.addEventListener('input', e => { if (c) c.classList.toggle('visible', e.target.value.length > 0); updateAutocomplete(e.target.value); filterHall(); });
    if (b) b.addEventListener('click', e => { if (e.target.classList.contains('autocomplete-item')) { i.value = e.target.textContent; b.style.display = 'none'; i.dispatchEvent(new Event('input')); } });
}

function updateAutocomplete(q) {
    const b = document.getElementById('autocomplete-box');
    if (!q) { if (b) b.style.display = 'none'; return; }
    const ql = q.toLowerCase(), u = [...new Set(bookingsCache.filter(x => x.status !== 'cancelled' && x.status !== 'expired').map(x => x.viewer_name || x.contact).filter(Boolean))].filter(v => v.toLowerCase().includes(ql));
    if (!u.length) { b.style.display = 'none'; return; }
    b.innerHTML = u.slice(0, 8).map(v => `<div class="autocomplete-item">${v}</div>`).join('');
    b.style.display = 'block';
}

function clearSearch() {
    const i = document.getElementById('search-input'); i.value = ''; i.dispatchEvent(new Event('input'));
}

// 🔑 ИСПРАВЛЕННАЯ ГЕНЕРАЦИЯ СЕТКИ (УБРАНЫ NaN И СХЛОПЫВАНИЯ)
function renderGrid() {
    const g = document.getElementById('vol-grid');
    if (!g) return;
    g.innerHTML = '';
    
    layout.rows = parseInt(layout.rows) || 10; 
    layout.cols = parseInt(layout.cols) || 10;
    if (layout.cols <= 0) return;

    g.style.display = 'grid'; 
    g.style.gap = '8px'; 
    g.style.justifyContent = 'center';

    const aisleStr = String(layout.aisle || '0');
    // Сортируем проходы по возрастанию
    const aisles = aisleStr.split(',').map(s => parseInt(s.trim())).filter(n => n > 0 && n < layout.cols).sort((a, b) => a - b);

    // 24px — ширина колонки для номера ряда
    let template = '24px'; 
    let tCur = 1;
    
    // Строим шаблон сетки
    for (const a of aisles) {
        // 🔑 Math.max(1, ...) предотвращает repeat(0), который ломает сетку
        const count = Math.max(1, a - tCur + 1);
        // 🔑 Добавлен пробел перед repeat, иначе CSS не сработает
        template += ` repeat(${count}, 36px) 24px`; 
        tCur = a + 1; 
    }
    if (tCur <= layout.cols) {
        template += ` repeat(${Math.max(1, layout.cols - tCur + 1)}, 36px)`;
    }
    
    g.style.gridTemplateColumns = template.trim();

    const s = document.getElementById('search-input')?.value.toLowerCase().trim() || '';
    
    // Рисуем ряды
    for (let r = 1; r <= layout.rows; r++) {
        let cur = 1; // Сброс счетчика для каждого ряда
        
        // Номер ряда
        const l = document.createElement('div'); 
        l.className = 'row-label'; 
        l.textContent = r; 
        g.appendChild(l);
        
        for (const a of aisles) {
            for (let c = cur; c <= a; c++) createVolSeat(g, r, c, s);
            
            // Проход (пустая колонка 24px)
            const aisleEl = document.createElement('div'); 
            aisleEl.className = 'aisle'; 
            g.appendChild(aisleEl);
            
            cur = a + 1;
        }
        for (let c = cur; c <= layout.cols; c++) createVolSeat(g, r, c, s);
    }
}

// 🔑 КОРРЕКТНОЕ СРАВНЕНИЕ ТИПОВ В ЯЧЕЙКЕ
function createVolSeat(g, r, c, srch) {
    const seatData = bookingsCache.filter(x => x.row === r && x.seat === c);
    let cls = 'free', activeBooking = null;
    
    // Приоритет: verified/already > booked/reserved > free
    activeBooking = seatData.find(b => b.status === 'verified' || b.status === 'already');
    if (!activeBooking) activeBooking = seatData.find(b => b.status === 'reserved' || b.status === 'booked');
    
    if (activeBooking) {
        cls = (activeBooking.status === 'verified' || activeBooking.status === 'already') ? 'verified' : 'booked';
    }

    const btn = document.createElement('button');
    btn.className = `seat ${cls}`;
    btn.textContent = c;

    const mt = activeBooking ? `${activeBooking.viewer_name || ''}${activeBooking.contact || ''}`.toLowerCase() : '';
    if (srch) btn.classList.add(mt.includes(srch) ? 'match' : 'dim');

    if (groupMode && cls === 'free') {
        if (groupSeats.some(x => x.row === r && x.col === c)) btn.classList.add('group-selected');
        btn.onclick = e => { e.stopPropagation(); toggleGroupSeat(r, c); };
    } else if (cls === 'free') {
        btn.onclick = e => { e.stopPropagation(); openWalkInModal(r, c); };
    } else {
        btn.onclick = e => { e.stopPropagation(); openResultModal(activeBooking); };
    }
    g.appendChild(btn); 
}

function filterHall() { renderGrid(); }
function toggleGroupMode() { groupMode = !groupMode; const b = document.getElementById('btn-group-mode'); if (b) b.classList.toggle('active', groupMode); if (!groupMode) clearGroupSelection(); else renderGrid(); }
function toggleGroupSeat(r, c) { if (groupSeats.length >= 10 && !groupSeats.some(x => x.row === r && x.col === c)) return alert('Максимум 10 мест'); const i = groupSeats.findIndex(x => x.row === r && x.col === c); if (i > -1) groupSeats.splice(i, 1); else groupSeats.push({ row: r, col: c }); updateGroupPanel(); renderGrid(); }
function clearGroupSelection() { groupSeats = []; document.getElementById('group-name').value = ''; document.getElementById('group-contact').value = ''; updateGroupPanel(); renderGrid(); }
function updateGroupPanel() { const p = document.getElementById('group-panel'), c = document.getElementById('group-count'); if (p && c) { c.textContent = groupSeats.length; p.classList.toggle('hidden', !groupSeats.length); } }

async function submitGroupBooking() {
    const n = document.getElementById('group-name').value.trim(), co = document.getElementById('group-contact').value.trim();
    if (!n) return alert('Введите имя группы'); if (!groupSeats.length) return;
    try {
        const res = await fetch(`${API}/vol/book-group?token=${volToken}&_t=${Date.now()}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ show_id: parseInt(currentShowId), seats: groupSeats, name: n, contact: co })
        });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail);
        playBeep('success');
        if (d.bookings) d.bookings.forEach(nb => bookingsCache.push(nb));
        clearGroupSelection(); toggleGroupMode(); loadShowData();
    } catch (e) { alert('❌ ' + e.message); clearGroupSelection(); await loadShowData(); }
}

function openScanner() {
    const m = document.getElementById('scanner-modal');
    if (m) m.classList.add('active');
    if (typeof Html5Qrcode !== 'undefined') {
        if (!scanner) scanner = new Html5Qrcode("reader");
        scanner.start({ facingMode: "environment" }, { fps: 10, qrbox: { width: 250, height: 250 } }, onScanSuccess, () => {});
    } else alert('Библиотека сканера не загружена');
}
function closeScanner() { if (scanner) scanner.stop().catch(() => {}); const m = document.getElementById('scanner-modal'); if (m) m.classList.remove('active'); }

async function onScanSuccess(txt) {
    try {
        const u = new URL(txt), t = u.searchParams.get('token');
        if (!t) return alert('QR не содержит токена');
        if (t === lastScanned.token && (Date.now() - lastScanned.time) < SCANNER_COOLDOWN) return playBeep('warn');
        lastScanned = { token: t, time: Date.now() };
        closeScanner(); await processScan(t);
    } catch (e) { alert('Ошибка сканирования'); closeScanner(); }
}

// В файле static/volunteer.js найдите и замените функцию processScan:

async function processScan(token) {
    try {
        const res = await fetch(`${API}/vol/verify?token=${volToken}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token })
        });
        const d = await res.json();

        // 1️⃣ Уже проверен
        if (res.status === 409) {
            playBeep('warn');
            const b = bookingsCache.find(x => x.cancel_token === token);
            if (b) { 
                openResultModal(b); 
                document.getElementById('res-status').className = 'status-badge status-warn'; 
                document.getElementById('res-status').textContent = `⚠️ ${d.message || 'Уже проверен'}`; 
            }
            return;
        }

        // 2️⃣ Ошибка сервера
        if (!res.ok) throw new Error(d.detail || 'Ошибка');

        // 3️⃣ УСПЕХ ✅
        playBeep('success');
        
        // 🔑 МГНОВЕННО обновляем статус в памяти, НЕ ожидая ответа от сервера
        const idx = bookingsCache.findIndex(x => x.cancel_token === token);
        if (idx !== -1) {
            bookingsCache[idx].status = 'verified';
        }
        renderGrid(); // Сетка перерисовывается сразу, место становится синим и НЕ сбрасывается

        // Открываем модалку
        const b = bookingsCache[idx];
        if (b) {
            openResultModal(b);
            document.getElementById('res-status').className = 'status-badge status-ok';
            document.getElementById('res-status').textContent = '✅ Зритель прошёл контроль';
        }

        // Фоновая синхронизация с БД (БЕЗ await, чтобы не блокировать UI и не перезаписывать статус)
        setTimeout(() => loadShowData().catch(() => {}), 500);

    } catch (e) {
        playBeep('warn');
        alert('❌ ' + e.message);
        await loadShowData();
        addToQueue('verify', { token });
    }
}

function openResultModal(b) {
    selectedBooking = { ...b };
    const safeStatus = String(b.status || 'booked');
    
    document.getElementById('res-title').textContent = 'Просмотр брони';
    document.getElementById('res-name').value = b.viewer_name || '';
    document.getElementById('res-contact').value = b.contact || '';
    document.getElementById('new-row').value = b.row;
    document.getElementById('new-col').value = b.seat;
    document.querySelector('.seat-picker').style.display = 'block';
    
    const bd = document.getElementById('btn-danger'), bs = document.getElementById('btn-success'), bp = document.getElementById('btn-primary');
    bd.onclick = null; bs.onclick = null; bp.onclick = null;
    
    if (safeStatus === 'cancelled') {
        document.getElementById('res-status').className = 'status-badge status-warn'; 
        document.getElementById('res-status').textContent = '⚠️ Место отменено (свободно)';
        bd.style.display = 'block'; bd.textContent = '❌ Закрыть'; bd.onclick = closeResult;
        bs.style.display = 'block'; bs.textContent = '✅ Посадить зрителя'; bs.onclick = () => seatCancelledViewer(b.id);
        bp.style.display = 'none';
    } else if (safeStatus === 'verified' || safeStatus === 'already') {
        document.getElementById('res-status').className = 'status-badge status-ok'; 
        document.getElementById('res-status').textContent = '✅ Зритель уже в зале';
        bd.style.display = 'none'; 
        bs.style.display = 'block'; bs.textContent = '💾 Сохранить'; bs.onclick = saveChanges; 
        bp.style.display = 'none';
    } else {
        document.getElementById('res-status').className = 'status-badge status-info'; 
        document.getElementById('res-status').textContent = `Ряд ${b.row} | Место ${b.seat} | ${translate(safeStatus)}`;
        bd.style.display = 'block'; bd.textContent = '🗑️ Отменить'; bd.onclick = cancelBooking;
        bs.style.display = 'none'; 
        bp.style.display = 'block'; bp.textContent = '✅ Отметить вход'; bp.onclick = verifyBooking;
    } 
    document.getElementById('result-modal').classList.add('active'); 
}

async function openWalkInModal(row, col) {
    await loadShowData();
    const b = bookingsCache.find(x => Number(x.row) === row && Number(x.seat) === col && x.status !== 'cancelled' && x.status !== 'expired');
    if (b) { openResultModal(b); return; }
    selectedBooking = null;
    document.getElementById('res-title').textContent = 'Посадка зрителя';
    document.getElementById('res-status').className = 'status-badge status-info';
    document.getElementById('res-status').textContent = `Свободное место: Ряд ${row} | Место ${col}`;
    document.getElementById('res-name').value = ''; document.getElementById('res-contact').value = '';
    document.getElementById('new-row').value = row; document.getElementById('new-col').value = col;
    document.querySelector('.seat-picker').style.display = 'none';
    const bd = document.getElementById('btn-danger'), bs = document.getElementById('btn-success'), bp = document.getElementById('btn-primary');
    bd.onclick = null; bs.onclick = null; bp.onclick = null;
    bd.style.display = 'block'; bd.textContent = '❌ Закрыть'; bd.onclick = closeResult;
    bs.style.display = 'block'; bs.textContent = '✅ Посадить зрителя'; bs.onclick = () => seatWalkIn(row, col);
    bp.style.display = 'none';
    document.getElementById('result-modal').classList.add('active');
}

function closeResult() { document.getElementById('result-modal').classList.remove('active'); selectedBooking = null; }
async function cancelBooking() { if (!selectedBooking || !confirm('Отменить?')) return; try { const res = await fetch(`${API}/vol/cancel?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: selectedBooking.id }) }); if (!res.ok) throw new Error('Ошибка'); playBeep('success'); loadShowData(); closeResult(); } catch (e) { playBeep('warn'); alert('❌ ' + e.message); setTimeout(loadShowData, 300); } }
async function verifyBooking() { if (!selectedBooking) return; try { const res = await fetch(`${API}/vol/verify?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: selectedBooking.cancel_token }) }); if (!res.ok) throw new Error(res.detail); playBeep('success'); loadShowData(); closeResult(); } catch (e) { alert(e.message); } }
async function saveChanges() { if (!selectedBooking) return; const n = document.getElementById('res-name').value.trim(), co = document.getElementById('res-contact').value.trim(), row = parseInt(document.getElementById('new-row').value), col = parseInt(document.getElementById('new-col').value); try { await fetch(`${API}/vol/update?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: selectedBooking.id, name: n, contact: co }) }); if (row && col && (row !== selectedBooking.row || col !== selectedBooking.seat)) await fetch(`${API}/vol/move?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: selectedBooking.id, new_row: row, new_col: col }) }); playBeep('success'); loadShowData(); closeResult(); } catch (e) { playBeep('warn'); alert(e.message); addToQueue('update', { booking_id: selectedBooking.id, name: n, contact: co, new_row: row, new_col: col }); } }
async function seatCancelledViewer(id) { const n = document.getElementById('res-name').value.trim(), co = document.getElementById('res-contact').value.trim(); if (!n) return alert('Введите имя'); try { await fetch(`${API}/vol/update?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ booking_id: id, name: n, contact: co, status: 'verified' }) }); playBeep('success'); loadShowData(); closeResult(); } catch (e) { alert('Ошибка: ' + e.message); } }
async function seatWalkIn(row, col) { const n = document.getElementById('res-name').value.trim(), co = document.getElementById('res-contact').value.trim(); if (!n) return alert('Введите имя'); try { const res = await fetch(`${API}/vol/book?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ show_id: parseInt(currentShowId), row: parseInt(row), col: parseInt(col), name: n, contact: co }) }); const d = await res.json(); if (res.status === 409) { playBeep('warn'); await loadShowData(); const b = bookingsCache.find(x => Number(x.row) === Number(row) && Number(x.seat) === Number(col)); if (b) { openResultModal(b); document.getElementById('res-status').className = 'status-badge status-warn'; document.getElementById('res-status').textContent = `⚠️ ${d.detail}`; } return; } if (!res.ok) throw new Error(d.detail); playBeep('success'); if (d.booking) bookingsCache.push(d.booking); renderGrid(); closeResult(); } catch (e) { alert('❌ ' + e.message); await loadShowData(); } }

function setupOfflineSync() { window.addEventListener('online', flushQueue); window.addEventListener('offline', updateSyncStatus); updateSyncStatus(); }
function updateSyncStatus() { const el = document.getElementById('sync-status'); if (el) { el.textContent = navigator.onLine ? '🟢 Онлайн' : '🔴 Оффлайн'; el.className = `badge ${navigator.onLine ? 'online' : 'offline'}`; } }
function addToQueue(t, p) { const q = JSON.parse(localStorage.getItem('vol_queue') || '[]'); q.push({ type: t, payload: p, ts: Date.now() }); localStorage.setItem('vol_queue', JSON.stringify(q)); updateSyncStatus(); }
async function flushQueue() { if (!navigator.onLine) return; const q = JSON.parse(localStorage.getItem('vol_queue') || '[]'); if (!q.length) return; try { await fetch(`${API}/vol/sync?token=${volToken}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ queue: q }) }); localStorage.removeItem('vol_queue'); updateSyncStatus(); loadShowData(); } catch (e) {} }
function translate(s) { return { free: 'Свободно', reserved: 'Забронировано', booked: 'Забронировано', verified: 'В зале', cancelled: 'Отменено', already: 'Уже проверен' }[s] || s; }
window.onload = () => { if (sessionStorage.getItem('vol_token')) { const i = document.getElementById('vol-token'); if (i) i.value = sessionStorage.getItem('vol_token'); loginVol(); } };