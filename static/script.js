const API = '/api';
// 🔑 Глобальный плейсхолдер для постеров (inline SVG)
const POSTER_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='800' viewBox='0 0 600 800'%3E%3Crect fill='%23e0e7ff' width='600' height='800'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236c5ce7' font-family='system-ui' font-size='24'%3EНет постера%3C/text%3E%3C/svg%3E";
window.POSTER_PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='800' viewBox='0 0 600 800'%3E%3Crect fill='%23e0e7ff' width='600' height='800'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236c5ce7' font-family='system-ui' font-size='24'%3EНет постера%3C/text%3E%3C/svg%3E";
window.POSTER_PLACEHOLDER_SMALL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='600' height='300' viewBox='0 0 600 300'%3E%3Crect fill='%23e0e7ff' width='600' height='300'/%3E%3Ctext x='50%25' y='50%25' dominant-baseline='middle' text-anchor='middle' fill='%236c5ce7' font-family='system-ui' font-size='20'%3EАфиша%3C/text%3E%3C/svg%3E";
// Форматирует дату из "ГГГГ-ММ-ДД" в "дд.мм.гггг"
function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}.${parts[1]}.${parts[0]}`;
}
let currentShowId = null;
let currentCancelToken = null;
let layout = { rows: 0, cols: 0, aisle: '0' };
let bookedSeats = {};
let selectedSeat = null;
let allShows = [];
let captchaAnswer = null;
let bookingOpen = true;

document.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('shows-list')) return;
  loadShows();
  window.addEventListener('click', e => {
    if (e.target.id === 'booking-modal') window.closeBookingModal();
    if (e.target.id === 'success-modal') window.closeSuccessModal();
  });
  const ansInput = document.getElementById('captcha-answer');
  if (ansInput) ansInput.addEventListener('input', function() {
    this.classList.remove('input-error');
    const errEl = document.getElementById('captcha-error');
    if (errEl) errEl.style.display = 'none';
  });
});



window.generateCaptcha = () => {
  const a = Math.floor(Math.random() * 9) + 1, b = Math.floor(Math.random() * 9) + 1;
  const isSub = Math.random() > 0.5;
  const n1 = isSub ? Math.max(a,b) : a, n2 = isSub ? Math.min(a,b) : b;
  captchaAnswer = isSub ? n1 - n2 : n1 + n2;
  const qEl = document.getElementById('captcha-question'), aEl = document.getElementById('captcha-answer'), errEl = document.getElementById('captcha-error');
  if (qEl) qEl.textContent = `${n1} ${isSub?'-':'+'} ${n2} = ?`;
  if (aEl) { aEl.value = ''; aEl.classList.remove('input-error'); }
  if (errEl) errEl.style.display = 'none';
};

window.submitBooking = async () => {
    const btn = document.getElementById('btn-book'); if (!btn) return;
    const aEl = document.getElementById('captcha-answer'), errEl = document.getElementById('captcha-error');
    const val = aEl ? parseInt(aEl.value.trim(), 10) : NaN;
    if (aEl) aEl.classList.remove('input-error'); if (errEl) errEl.style.display = 'none';
    if (isNaN(val) || val !== captchaAnswer) { if(aEl)aEl.classList.add('input-error'); aEl?.focus(); if(errEl)errEl.style.display='block'; return; }
    const name = document.getElementById('seat-name').value.trim(), consent = document.getElementById('seat-consent').checked;
    if (!name) return alert('Введите имя'); if (!consent) return alert('Необходимо согласие'); if (!selectedSeat) return alert('Выберите место');

    // 🔑 СОХРАНЯЕМ ДАННЫЕ ДО ОЧИСТКИ ФОРМЫ
    const bookedSeat = { row: selectedSeat.row, col: selectedSeat.col };
    const viewerName = name; // Копируем имя в переменную

    btn.textContent = '⏳ Бронирование...'; btn.disabled = true;
    try {
        const res = await fetch(`${API}/book`, { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ show_id:parseInt(currentShowId), row:parseInt(bookedSeat.row), seat:parseInt(bookedSeat.col), name, contact:document.getElementById('seat-contact').value.trim(), consent }) });
        const d = await res.json();
        if (!res.ok) throw new Error(d.detail || 'Не удалось забронировать');
        
        window.closeBookingModal(); // Теперь здесь безопасно очищает форму
        openSuccessModal(d, bookedSeat, viewerName); // 🔑 Передаём сохранённое имя
        loadLayout(currentShowId);
    } catch(e) { alert('❌ ' + e.message); }
    finally { btn.textContent = 'Забронировать'; btn.disabled = false; }
};

function selectSeat(r, c) {
  selectedSeat = { row: r, col: c }; window.generateCaptcha();
  document.getElementById('modal-title').textContent = 'Бронирование места';
  document.getElementById('modal-info').innerHTML = `<p>Ряд: <b>${r}</b> | Место: <b>${c}</b></p>`;
  document.getElementById('booking-modal').classList.add('active');
  document.getElementById('seat-name').focus();
}
window.closeBookingModal = () => {
  document.getElementById('booking-modal').classList.remove('active'); selectedSeat = null;
  ['seat-name','seat-contact'].forEach(id => document.getElementById(id).value = '');
  document.getElementById('seat-consent').checked = true;
};

async function loadShows() {
  const c = document.getElementById('shows-list'); c.innerHTML = '<p class="loading">⏳ Загрузка афиши...</p>';
  
  try {
    const res = await fetch(`${API}/shows`); if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allShows = await res.json();
    if (!allShows.length) { c.innerHTML = '<p class="loading">Спектакли временно отсутствуют</p>'; return; }
    
    c.innerHTML = allShows.map(s => `
      <div class="show-card" onclick="showShowDetails(${s.id})">
        <img src="${s.poster || window.POSTER_PLACEHOLDER_SMALL}" alt="${s.title}" onerror="this.src=window.POSTER_PLACEHOLDER_SMALL">
        <div class="show-card-body">
          <h3>${s.title}</h3>
          <div class="date">📅 ${formatDate(s.date)} | 🕒 ${s.time}${s.venue_address ? ` | 📍 ${s.venue_address}` : ''}</div>
          <div class="description">${(s.description||'').substring(0,100)}${(s.description||'').length>100?'...':''}</div>
          <button class="btn primary" onclick="event.stopPropagation(); showShowDetails(${s.id})">Подробнее</button>
        </div>
      </div>
    `).join('');
  } catch(e) { c.innerHTML = '<p class="loading" style="color:#ef4444;">Не удалось загрузить афишу</p>'; }
}

window.showShowDetails = (id) => {
    const s = allShows.find(x => x.id === id); if (!s) return;
    
    // 🔑 Используем глобальный плейсхолдер для детального просмотра
    document.getElementById('show-poster').src = s.poster || window.POSTER_PLACEHOLDER;
    document.getElementById('show-title').textContent = s.title;
    
    // ✅ Объединяем дату, время и адрес в одной строке
    const dateEl = document.getElementById('show-date');
    if (dateEl) {
        const venuePart = s.venue_address ? ` | 📍 ${s.venue_address}` : '';
        dateEl.textContent = `📅 ${formatDate(s.date)} | 🕒 ${s.time}${venuePart}`;
    }
    
    document.getElementById('show-full-desc').textContent = s.description || 'Захватывающее представление.';
    window.showSeatSelection(id);
};
window.showSeatSelection = (id) => { currentShowId=id; document.getElementById('shows-section').classList.remove('active'); document.getElementById('seats-section').classList.add('active'); window.scrollTo(0,0); loadLayout(id); };
window.showShowsList = () => { document.getElementById('seats-section').classList.remove('active'); document.getElementById('shows-section').classList.add('active'); currentShowId=null; selectedSeat=null; };

async function loadLayout(showId) {
    const grid = document.getElementById('seat-grid');
    if(!grid) return;
    grid.innerHTML = '<p class="loading">⏳ Загрузка схемы...</p>';
    try {
        const res = await fetch(`${API}/shows/${showId}/layout`);
        if(!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        
        layout = {
            rows: parseInt(d.rows) || 10,
            cols: parseInt(d.cols) || 10,
            aisle: d.aisle_after_col || '0'
        };
        bookedSeats = d.booked || {};
        bookingOpen = d.booking_open !== false;
        
        renderGrid();
        if (!bookingOpen) {
            grid.insertAdjacentHTML('beforebegin', `<div style="text-align:center; background:#fef3c7; color:#92400e; padding:8px; border-radius:8px; margin-bottom:10px; font-weight:500;">📢 Онлайн-бронирование приостановлено.</div>`);
        }
    } catch(e) { 
        grid.innerHTML = '<p class="loading" style="color:#ef4444;">Не удалось загрузить схему</p>'; 
    }
}

function renderGrid() {
    const grid = document.getElementById('seat-grid'); 
    if(!grid) return; 
    grid.innerHTML = '';
    if(layout.cols <= 0) return;

    grid.style.display = 'grid'; grid.style.gap = '6px'; grid.style.justifyContent = 'center';

    const aisleStr = String(layout.aisle || '0');
    const aisles = aisleStr.split(',').map(s => parseInt(s.trim())).filter(n => n > 0 && n < layout.cols).sort((a,b) => a - b);

    let template = '40px', tCur = 1;
    for (const a of aisles) {
        const count = Math.max(1, a - tCur + 1);
        template += ` repeat(${count}, 38px) 24px`;
        tCur = a + 1;
    }
    if (tCur <= layout.cols) template += ` repeat(${layout.cols - tCur + 1}, 38px)`;
    grid.style.gridTemplateColumns = template.trim();

    for(let r = 1; r <= layout.rows; r++) {
        let cur = 1; // 🔑 КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ
        grid.appendChild(Object.assign(document.createElement('div'), {className:'row-label', textContent:r}));
        for (const a of aisles) {
            for (let c = cur; c <= a; c++) createSeatBtn(grid, r, c);
            const aisle = document.createElement('div'); aisle.className = 'aisle'; grid.appendChild(aisle);
            cur = a + 1;
        }
        for (let c = cur; c <= layout.cols; c++) createSeatBtn(grid, r, c);
    }
}

function createSeatBtn(grid, r, c) {
  const key = `${r},${c}`, status = bookedSeats[key] || 'free';
  const isFree = status === 'free' || status === 'cancelled' || status === 'expired';
  const btn = document.createElement('button');
  btn.className = (status === 'verified' || status === 'already') ? 'seat verified' : (isFree ? 'seat available' : 'seat booked');
  btn.textContent = c; btn.disabled = !isFree;
  btn.title = isFree ? `Ряд ${r}, Место ${c}` : (status === 'verified' ? `Зритель в зале` : `Забронировано`);
  if (isFree && bookingOpen) btn.onclick = () => selectSeat(r, c);
  grid.appendChild(btn);
}

function openSuccessModal(d, seatInfo, viewerName) {
    window.currentBookingId = d.booking_id;
    window.currentCancelToken = d.token;

    const show = allShows.find(x => x.id === parseInt(currentShowId));
    const venueStr = (show && show.venue_address) ? show.venue_address : '';
    
    let formattedDate = '';
    if (show && show.date) {
        const parts = show.date.split('-');
        if (parts.length === 3) formattedDate = `${parts[2]}.${parts[1]}.${parts[0]}`;
        else formattedDate = show.date;
    }

    const row = seatInfo ? seatInfo.row : '?';
    const col = seatInfo ? seatInfo.col : '?';
    const finalName = viewerName || 'Зритель'; // Берём переданное имя

    const ticketHtml = `
        <div class="ticket-stub">
            <h3 style="margin:0 0 8px; text-align:center; color:var(--primary); font-size:1.2rem;">${show ? show.title : 'Спектакль'}</h3>
            <p style="margin:4px 0; font-size:0.95rem;"><strong>📅 ${formattedDate}</strong> | 🕒 ${show ? show.time : '--:--'}</p>
            ${venueStr ? `<p style="margin:4px 0; font-size:0.95rem;">📍 ${venueStr}</p>` : ''}
            
            <hr style="border:0; border-top:1px dashed var(--border); margin:12px 0;">
            
            <p style="margin:4px 0; font-size:1rem;"><strong>👤 ${finalName}</strong></p>
            <p style="margin:4px 0; font-size:1.3rem; font-weight:bold; color:var(--text);">🪑 Ряд: ${row} | Место: ${col}</p>
        </div>
    `;

    const infoEl = document.getElementById('success-info');
    if (infoEl) infoEl.innerHTML = ticketHtml;

    const qr = document.getElementById('qr-code');
    if (qr) {
        const cancelUrl = `${window.location.origin}/api/cancel?token=${d.token}`;
        qr.innerHTML = `<img src="https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(cancelUrl)}&color=6c5ce7" alt="QR" style="width: 220px; height: 220px; display: block; margin: 0 auto;">`;
    }

    document.getElementById('success-modal').classList.add('active');
}

window.cancelBookingFromSuccess = async(token) => { if(!confirm('Отменить бронь?'))return; try{await fetch(`${API}/cancel?token=${encodeURIComponent(token)}`); document.getElementById('success-modal').classList.remove('active'); loadLayout(currentShowId); alert('✅ Отменено.');}catch(e){alert('❌ '+e.message);} };
window.closeSuccessModal = () => document.getElementById('success-modal').classList.remove('active');
window.downloadCurrentPdf = () => window.currentBookingId ? downloadTicketPdf(window.currentBookingId) : alert('Нет активной брони');
async function downloadTicketPdf(id){ try{const r=await fetch(`${API}/bookings/${id}/pdf`); if(!r.ok)throw new Error(await r.text()); const b=await r.blob(), u=URL.createObjectURL(b), a=document.createElement('a'); a.href=u; a.download=`ticket_${id}.pdf`; document.body.appendChild(a); a.click(); URL.revokeObjectURL(u); a.remove();}catch(e){alert('❌ '+e.message);} }
window.copyText = (txt) => navigator.clipboard.writeText(txt).then(()=>alert('✅ Ссылка скопирована!'));