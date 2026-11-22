const API = '/api';
let currentShowId = null, currentEditShowId = null, showsCache = [], occupancyChart = null, volChart = null;
let selectedVolId = null, volDetailChart = null, currentEditVolId = null;
let tableMap = {}, isTableMode = false, currentTableColor = '#e0e7ff';

function formatDateRU(d) {
  if (!d) return '';
  const p = d.split('-');
  return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : d;
}

document.addEventListener('DOMContentLoaded', () => {
  console.log('✅ admin.js загружен');
  if (sessionStorage.getItem('admin_auth') === 'true') { window.showAdmin(); window.loadShows(); window.loadVolunteers(); }
  document.getElementById('admin-pass')?.addEventListener('keypress', e => e.key === 'Enter' && window.login());
  document.getElementById('search-input')?.addEventListener('input', window.filterBookings);
  document.getElementById('status-filter')?.addEventListener('change', window.filterBookings);
  document.getElementById('show-poster')?.addEventListener('change', function(e) {
    const f = e.target.files[0], p = document.getElementById('poster-preview');
    if (f) { p.src = URL.createObjectURL(f); p.style.display = 'block'; } else p.style.display = 'none';
  });

    const toggle = document.getElementById('table-mode-toggle');
    const picker = document.getElementById('table-color-picker');
    
    if (toggle) toggle.addEventListener('change', e => { 
        isTableMode = e.target.checked; 
        // Мгновенная перерисовка без перезагрузки модалки
        if (document.getElementById('layout-modal').style.display === 'flex') {
            window.renderAdminSeats(
                parseInt(document.getElementById('new-rows').value) || 10,
                parseInt(document.getElementById('new-cols').value) || 10,
                {}, 
                document.getElementById('new-aisle').value.trim(),
                tableMap
            );
        }
    });
    if (picker) picker.addEventListener('input', e => { 
        currentTableColor = e.target.value; 
        // Аналогично для палитры
        if (isTableMode && document.getElementById('layout-modal').style.display === 'flex') {
            window.renderAdminSeats(
                parseInt(document.getElementById('new-rows').value) || 10,
                parseInt(document.getElementById('new-cols').value) || 10,
                {}, 
                document.getElementById('new-aisle').value.trim(),
                tableMap
            );
        }
    });

  const oc = document.getElementById('occupancyChart');
  if (oc) occupancyChart = new Chart(oc.getContext('2d'), { type: 'doughnut', data: { labels: ['Свободно', 'Забронировано', 'В зале'], datasets: [{ data: [0, 0, 0], backgroundColor: ['#10b981', '#f59e0b', '#3b82f6'] }] }, options: { responsive: true, plugins: { legend: { position: 'bottom' } } } });
  const vc = document.getElementById('volChart');
  if (vc) volChart = new Chart(vc.getContext('2d'), { type: 'bar', data: { labels: ['Активность', 'Проверки', 'Эффективность'], datasets: [{ label: 'Метрики', data: [0, 0, 0], backgroundColor: ['#6c5ce7', '#10b981', '#3b82f6'] }] }, options: { responsive: true, plugins: { legend: { display: false } } } });
});

window.openModal = id => { const e = document.getElementById(id); if (e) { e.classList.remove('hidden'); e.style.display = 'flex'; } };
window.closeModal = id => { const e = document.getElementById(id); if (e) { e.classList.add('hidden'); e.style.display = 'none'; } };

window.login = async () => {
  const p = document.getElementById('admin-pass').value;
  try {
    const r = await fetch(`${API}/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: p }) });
    if (r.ok) { sessionStorage.setItem('admin_auth', 'true'); window.showAdmin(); window.loadShows(); window.loadVolunteers(); }
    else throw new Error('Неверный пароль');
  } catch (e) { document.getElementById('login-error').textContent = e.message; }
};
window.logout = () => { sessionStorage.removeItem('admin_auth'); location.reload(); };
window.showAdmin = () => { document.getElementById('login-screen').style.display = 'none'; document.getElementById('admin-app').style.display = 'block'; };
window.switchTab = t => {
  document.querySelectorAll('.tab-btn').forEach((b, i) => b.classList.toggle('active', (t === 'shows' && i === 0) || (t === 'volunteers' && i === 1)));
  document.getElementById('shows-panel').classList.toggle('active', t === 'shows');
  document.getElementById('volunteers-panel').classList.toggle('active', t === 'volunteers');
  if (t === 'volunteers') window.loadVolunteers();
};

window.loadShows = async () => {
  try {
    showsCache = await fetch(`${API}/admin/shows`).then(r => r.json());
    const c = document.getElementById('shows-list'); c.innerHTML = '';
    showsCache.forEach(s => {
      const d = document.createElement('div');
      d.className = `show-item ${s.id === currentShowId ? 'active' : ''}`;
      d.innerHTML = `<div><strong>${s.title}</strong><br><small style="color:var(--text-muted)">${s.venue_address ? '📍 ' + s.venue_address + ' | ' : ''}${formatDateRU(s.date)} ${s.time}</small></div><span class="show-status ${s.status}">${s.status === 'active' ? 'Активен' : 'Архив'}</span>`;
      d.onclick = () => window.selectShow(s.id);
      const a = document.createElement('div'); a.className = 'vol-actions';
      a.innerHTML = `<button class="vol-btn" onclick="event.stopPropagation();window.editShow(${s.id})" title="Редактировать">✏️</button><button class="vol-btn" onclick="event.stopPropagation();window.deleteShow(${s.id})" title="Удалить" style="color:var(--danger)">🗑️</button>`;
      d.appendChild(a); c.appendChild(d);
    });
  } catch (e) { console.error(e); }
};

window.selectShow = async id => { currentShowId = id; document.getElementById('bookings-section').style.display = 'block'; window.loadShows(); await window.loadBookings(); };
window.loadBookings = async () => {
  if (!currentShowId) return;
  try { const r = await fetch(`${API}/admin/shows/${currentShowId}/bookings`); const bk = await r.json(); window.renderTable(bk); window.updateStats(bk); }
  catch (e) { console.error('Ошибка загрузки броней:', e); }
};
window.updateStats = bk => {
  if (!bk || !Array.isArray(bk)) return;
  const s = showsCache.find(x => x.id === currentShowId); if (!s) return;
  const tot = (parseInt(s.layout_rows) || 10) * (parseInt(s.layout_cols) || 10);
  const res = bk.filter(b => ['reserved', 'booked'].includes(b.status)).length;
  const ver = bk.filter(b => b.status === 'verified').length;
  const fre = Math.max(0, tot - res - ver);
  document.getElementById('stat-total').textContent = tot; document.getElementById('stat-reserved').textContent = res; document.getElementById('stat-verified').textContent = ver; document.getElementById('stat-free').textContent = fre;
  if (occupancyChart) { occupancyChart.data.datasets[0].data = [fre, res, ver]; occupancyChart.update(); }
};

window.renderTable = bk => {
  const tb = document.getElementById('bookings-body'); tb.innerHTML = '';
  document.getElementById('empty-state').style.display = bk.length ? 'none' : 'block';
  bk.forEach(b => {
    const tr = document.createElement('tr'); tr.dataset.status = b.status;
    tr.dataset.search = `${b.viewer_name || ''} ${b.contact || ''}`.toLowerCase();
    const ds = b.status === 'expired' ? 'cancelled' : b.status;
    const isRes = b.status === 'reserved' || b.status === 'booked';
    const isVer = b.status === 'verified';
    tr.innerHTML = `<td>${b.row}</td><td>${b.seat}</td><td>${b.viewer_name || '-'}</td><td>${b.contact || '-'}</td><td><span class="status-badge status-${ds}">${window.translateStatus(b.status)}</span></td><td>${new Date(b.created_at).toLocaleString()}</td><td>${isRes ? `<button class="action-btn cancel-btn" onclick="window.cancelBooking(${b.id})" title="Отменить">🗑️</button><button class="action-btn" onclick="window.resendTicket(${b.id})" title="Отправить">📧</button><button class="action-btn" onclick="window.downloadTicketPdf(${b.id})" title="PDF">📄</button>` : isVer ? '<span style="color:var(--text-muted);font-size:0.8rem">✅ В зале</span>' : '—'}<button class="action-btn" onclick="window.forceResetStatus(${b.id})" title="Сбросить">🔄</button></td>`;
    tb.appendChild(tr);
  });
};

window.filterBookings = () => {
  const s = document.getElementById('search-input').value.toLowerCase();
  const f = document.getElementById('status-filter').value;
  document.querySelectorAll('#bookings-body tr').forEach(r => {
    let matchF = f === 'all' || r.dataset.status === f;
    if (f === 'reserved') matchF = matchF || r.dataset.status === 'booked';
    r.style.display = r.dataset.search.includes(s) && matchF ? '' : 'none';
  });
};

window.translateStatus = s => ({ reserved: 'Резерв', booked: 'Бронь', verified: 'В зале', cancelled: 'Отменено', expired: 'Отменено', free: 'Свободно' }[s] || s);
window.cancelBooking = async id => { if (!confirm('Отменить?')) return; try { await fetch(`${API}/admin/bookings/${id}/cancel`, { method: 'POST' }); window.loadBookings(); } catch (e) { alert(e.message); } };
window.forceResetStatus = async id => { if (!confirm('Сбросить?')) return; try { await fetch(`${API}/admin/bookings/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'reserved' }) }); window.loadBookings(); } catch (e) { alert(e.message); } };

window.toggleShowStatus = async () => {
  const btn = document.getElementById('btn-toggle-status'); if (!btn || !currentShowId) return;
  const ns = btn.textContent.includes('Архив') ? 'archived' : 'active';
  try {
    await fetch(`${API}/admin/shows/${currentShowId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: ns }) });
    await window.loadShows();
    const updated = showsCache.find(s => s.id === currentShowId);
    if (updated) btn.textContent = updated.status === 'active' ? '⏸️ Архивировать' : '▶️ Вернуть';
  } catch (e) { console.error(e); alert('❌ ' + e.message); }
};
window.exportCSV = () => { if (!currentShowId) return alert('Выберите спектакль'); window.location.href = `${API}/admin/shows/${currentShowId}/export`; };
window.downloadTicketPdf = async id => { try { const r = await fetch(`${API}/bookings/${id}/pdf`); if (!r.ok) throw new Error(); const b = await r.blob(), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = `ticket_${id}.pdf`; document.body.appendChild(a); a.click(); URL.revokeObjectURL(u); a.remove(); } catch (e) { alert('❌ ' + e.message); } };
window.resendTicket = async id => { try { const r = await fetch(`${API}/admin/bookings/${id}/resend`, { method: 'POST' }); alert((await r.json()).message); } catch (e) { alert('Ошибка сети'); } };
window.toggleBookingPause = async () => {
  if (!currentShowId) return alert('Выберите спектакль');
  const cur = showsCache.find(s => s.id === currentShowId); const ns = !cur?.booking_open;
  try { await fetch(`${API}/admin/shows/${currentShowId}/booking-status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ open: ns }) }); document.getElementById('btn-booking-toggle').textContent = ns ? '⏸️ Остановить бронь' : '▶️ Открыть бронь'; window.loadShows(); window.loadBookings(); } catch (e) { alert(e.message); }
};

// === СХЕМА ЗАЛА ===
window.openLayoutModal = async () => {
    if (!currentShowId) return alert('Выберите спектакль');
    window.openModal('layout-modal');
    document.getElementById('layout-title').textContent = 'Загрузка...';
    document.getElementById('admin-seat-grid').innerHTML = '<p style="text-align:center">Загрузка...</p>';
    
    // 🔑 УДАЛИ ОТСЮДА СТРОКИ: isTableMode = false; tableMap = {}; и сброс чекбоксов
    // Оставь только загрузку карты с сервера:
    try {
        const r = await fetch(`${API}/shows/${currentShowId}/layout`);
        if (!r.ok) throw new Error('Ошибка');
        const d = await r.json();
        tableMap = d.table_layout || {}; // Загружаем только карту, режим не трогаем
        document.getElementById('layout-title').textContent = `${d.title} — Схема зала`;
        window.renderAdminSeats(d.rows, d.cols, d.booked, d.aisle_after_col || '0', tableMap);
    } catch (e) { document.getElementById('admin-seat-grid').innerHTML = `<p style="color:var(--danger)">Ошибка: ${e.message}</p>`; }
};
window.closeLayoutModal = () => window.closeModal('layout-modal');

window.renderAdminSeats = (rows, cols, map, aisleStr, tMap = {}) => {
    const g = document.getElementById('admin-seat-grid');
    if (!g) return;
    g.innerHTML = ''; g.style.display = 'grid'; g.style.gap = '6px';
    
    const r = parseInt(rows) || 10, c = parseInt(cols) || 10;
    const aisles = String(aisleStr || '0').split(',').map(s => parseInt(s.trim())).filter(n => n > 0 && n < c).sort((a, b) => a - b);

    let template = '28px', tCur = 1;
    for (const a of aisles) { template += ` repeat(${Math.max(1, a - tCur + 1)}, 34px) 24px`; tCur = a + 1; }
    if (tCur <= c) template += ` repeat(${c - tCur + 1}, 34px)`;
    g.style.gridTemplateColumns = template.trim();

    for (let row = 1; row <= r; row++) {
        let cur = 1;
        let seatNum = 1; // 🔑 Сквозной счетчик мест в ряду
        
        const label = document.createElement('div'); label.className = 'admin-row-label'; label.textContent = row; g.appendChild(label);
        
        for (const a of aisles) {
            for (let col = cur; col <= a; col++) {
                seatNum = createAdminSeatOrTable(g, row, col, map, tMap, c, aisles, seatNum);
            }
            const aisleDiv = document.createElement('div'); aisleDiv.className = 'admin-aisle'; g.appendChild(aisleDiv);
            cur = a + 1;
        }
        for (let col = cur; col <= c; col++) {
            seatNum = createAdminSeatOrTable(g, row, col, map, tMap, c, aisles, seatNum);
        }
    }
};

function createAdminSeatOrTable(g, row, col, m, tMap, maxCols, aisles=[], currentSeatNum) {
    const k = `${row},${col}`;
    
    // 1. Если это начало стола И следующее место не является проходом
    if (tMap[k] && col < maxCols && !aisles.includes(col + 1)) {
        const t = document.createElement('div');
        t.className = 'admin-seat table-cell';
        t.style.setProperty('--table-color', tMap[k]);
        
        // 🔑 ЯВНЫЙ РАСЧЕТ ТРЕКОВ: предотвращает сдвиг сетки и "поедание" прохода
        const startTrack = 1 + col + aisles.filter(a => a < col).length;
        t.style.gridColumn = `${startTrack} / ${startTrack + 2}`;
        
        t.textContent = '🪑';
        t.title = `Стол (ряд ${row})`;
        t.onclick = () => {
            if (isTableMode) { 
                delete tMap[k]; 
                delete tMap[`${row},${col+1}`]; 
                window.renderAdminSeats(parseInt(document.getElementById('new-rows').value)||10, parseInt(document.getElementById('new-cols').value)||10, {}, document.getElementById('new-aisle').value.trim(), tMap); 
            }
        };
        g.appendChild(t);
        return currentSeatNum; // Номер места НЕ увеличиваем для стола
    }
    
    // 2. Пропускаем правую половину стола (она уже отрисована)
    if (tMap[`${row},${col-1}`]) {
        return currentSeatNum;
    }
    
    // Защита от битых данных: если место помечено как стол, но оно у прохода, очищаем и рисуем как обычное место
    if (tMap[k] && aisles.includes(col + 1)) {
        delete tMap[k];
    }

    // 3. Обычное место
    const st = m[k] || 'free';
    const s = document.createElement('div');
    s.className = `admin-seat ${(st === 'cancelled' || st === 'expired') ? 'free' : st}`;
    s.textContent = currentSeatNum; // 🔑 Показываем пересчитанный номер
    s.title = `Ряд ${row}, Место ${currentSeatNum}: ${window.translateStatus(st)}`;
    
    // Разрешаем создавать стол только если следующее место не проход
    if (isTableMode && col < maxCols && !aisles.includes(col + 1)) { 
        s.style.cursor = 'crosshair'; 
        s.style.border = '2px dashed var(--primary)'; 
        s.onclick = () => { 
            tMap[k] = currentTableColor; 
            tMap[`${row},${col+1}`] = currentTableColor; 
            window.renderAdminSeats(parseInt(document.getElementById('new-rows').value)||10, parseInt(document.getElementById('new-cols').value)||10, {}, document.getElementById('new-aisle').value.trim(), tMap); 
        }; 
    }
    g.appendChild(s);
    return currentSeatNum + 1; // 🔑 Увеличиваем ТОЛЬКО для реальных мест
}

// === ВОЛОНТЁРЫ ===
window.loadVolunteers = async () => { try { const v = await fetch(`${API}/admin/volunteers`).then(r => r.json()); window.renderVols(v); document.getElementById('v-active').textContent = v.filter(x => x.is_active).length; document.getElementById('v-scans').textContent = v.reduce((a, x) => a + (x.verified_count || 0), 0); document.getElementById('v-hours').textContent = `${v.length * 3.5}ч`; if (volChart) { volChart.data.datasets[0].data = [v.length, v.reduce((a, x) => a + (x.verified_count || 0), 0), v.length ? 85 : 0]; volChart.update(); } if (!selectedVolId && v.length) window.selectVolunteer(v[0].id, v[0]); } catch (e) { console.error(e); } };
window.renderVols = v => { const c = document.getElementById('volunteers-list'); c.innerHTML = ''; if (!v.length) { c.innerHTML = '<p style="padding:10px;color:var(--text-muted)">Нет волонтёров</p>'; return; } v.forEach(x => { const d = document.createElement('div'); d.className = `vol-item ${x.id === selectedVolId ? 'active' : ''}`; d.innerHTML = `<div><strong>${x.name}</strong><br><small style="color:var(--text-muted)">${x.is_active ? '🟢 Активен' : '🔴 Отключен'}</small></div><div class="vol-actions"><button class="vol-btn" onclick="event.stopPropagation();window.openVolunteerModal({id:${x.id},name:'${x.name}'})" title="Привязка и настройки">⚙️</button><button class="vol-btn" onclick="event.stopPropagation();window.toggleVolunteer(${x.id},${x.is_active ? 0 : 1})" title="${x.is_active ? 'Отключить' : 'Активировать'}">${x.is_active ? '🟢' : '🔴'}</button></div>`; d.onclick = () => window.selectVolunteer(x.id, x); c.appendChild(d); }); };
window.selectVolunteer = async (id, v) => { selectedVolId = id; document.querySelectorAll('.vol-item').forEach(el => el.classList.toggle('active', el.innerHTML.includes(v.name))); document.getElementById('vol-detail-title').textContent = `📊 ${v.name}`; document.querySelector('.vol-details-panel').classList.remove('empty'); let assignedHtml = '<small>Загрузка...</small>'; try { const res = await fetch(`${API}/admin/volunteers/${id}/assignments`); if (res.ok) { const ids = await res.json(); const shows = showsCache.filter(s => ids.includes(s.id) && s.status === 'active'); assignedHtml = shows.length ? shows.map(s => `<span class="badge" style="background:#e0e7ff;color:var(--primary);padding:2px 6px;border-radius:4px;margin-right:4px;">${s.title}</span>`).join('') : '<span style="color:#ef4444">⚠️ Нет назначенных спектаклей</span>'; } } catch (e) {} const hours = ((Date.now() - new Date(v.created_at)) / (1000 * 60 * 60)).toFixed(1); const rate = hours > 0 ? ((v.verified_count || 0) / hours).toFixed(1) : '0'; document.getElementById('vol-stats-grid').innerHTML = `<div class="vol-stat-card"><span>${v.verified_count || 0}</span><small>Всего проверок</small></div><div class="vol-stat-card"><span>${hours}ч</span><small>Общее время</small></div><div class="vol-stat-card"><span>${rate}</span><small>Зрителей/час</small></div><div class="vol-stat-card"><span>${v.is_active ? 'Да' : 'Нет'}</span><small>Сейчас активен</small></div>`; document.getElementById('vol-info-text').innerHTML = `<strong>Доступные спектакли:</strong><br><div style="margin:6px 0;">${assignedHtml}</div><strong>Токен:</strong> <code style="background:#f1f5f9;padding:3px 6px;border-radius:4px;word-break:break-all;">${v.access_token}</code><br><strong>Дата:</strong> ${new Date(v.created_at).toLocaleString()}`; const ctx = document.getElementById('volDetailChart').getContext('2d'); if (volDetailChart) volDetailChart.destroy(); volDetailChart = new Chart(ctx, { type: 'radar', data: { labels: ['Проверки', 'Скорость', 'Надёжность', 'Активность'], datasets: [{ label: v.name, data: [Math.min(v.verified_count || 0, 100), Math.min(parseFloat(rate) * 10, 100), 90, v.is_active ? 100 : 0], backgroundColor: 'rgba(108,92,231,0.2)', borderColor: '#6c5ce7' }] }, options: { responsive: true, scales: { r: { beginAtZero: true, max: 100 } }, plugins: { legend: { display: false } } } }); };
window.openVolunteerModal = async (vol = null) => { currentEditVolId = vol?.id || null; window.openModal('create-vol-modal'); document.getElementById('vol-modal-title').textContent = vol ? `⚙️ Настройки: ${vol.name}` : '🤝 Новый волонтёр'; document.getElementById('vol-name').value = vol?.name || ''; document.getElementById('btn-create-vol').style.display = vol ? 'none' : 'block'; document.getElementById('btn-save-assign').style.display = vol ? 'block' : 'none'; const listEl = document.getElementById('vol-shows-list'); listEl.innerHTML = '<small style="color:#64748b;">Загрузка спектаклей...</small>'; try { const showsRes = await fetch(`${API}/admin/shows`); if (!showsRes.ok) throw new Error('Ошибка сети'); const shows = await showsRes.json(); let assignedIds = []; if (vol) { const assignRes = await fetch(`${API}/admin/volunteers/${vol.id}/assignments`); if (assignRes.ok) assignedIds = await assignRes.json(); } const activeShows = shows.filter(s => s.status === 'active'); if (activeShows.length === 0) { listEl.innerHTML = '<small style="color:#ef4444;">Нет активных спектаклей</small>'; return; } listEl.innerHTML = activeShows.map(s => `<label class="vol-assign-item"><input type="checkbox" value="${s.id}" ${assignedIds.includes(s.id) ? 'checked' : ''}><span>${s.title} <small style="color:#64748b;">(${formatDateRU(s.date)})</small></span></label>`).join(''); } catch (err) { console.error(err); listEl.innerHTML = '<small style="color:#ef4444;">Ошибка загрузки. Проверьте консоль.</small>'; } };
window.closeVolunteerModal = () => window.closeModal('create-vol-modal');
window.submitCreateVolunteer = async () => { const n = document.getElementById('vol-name').value.trim(); if (!n) return alert('Введите имя'); try { await fetch(`${API}/admin/volunteers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: n }) }); alert('✅ Создан. Нажмите ⚙️ в списке, чтобы назначить спектакли.'); window.closeVolunteerModal(); window.loadVolunteers(); } catch (e) { alert(e.message); } };
window.saveVolAssignments = async () => { if (!currentEditVolId) return alert('Сначала создайте волонтёра'); const checks = document.querySelectorAll('#vol-shows-list input:checked'); const showIds = Array.from(checks).map(cb => parseInt(cb.value)); try { await fetch(`${API}/admin/volunteers/${currentEditVolId}/assignments`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ show_ids: showIds }) }); alert('✅ Привязки сохранены!'); window.closeVolunteerModal(); window.loadVolunteers(); window.selectVolunteer(currentEditVolId, showsCache.find(s => true)); } catch (e) { alert('❌ ' + e.message); } };
window.toggleVolunteer = async (id, a) => { try { await fetch(`${API}/admin/volunteers/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: a }) }); window.loadVolunteers(); } catch (e) { alert(e.message); } };

// === CRUD СПЕКТАКЛЕЙ ===
window.openCreateShowModal = () => { currentEditShowId = null; window.openModal('create-show-modal'); document.getElementById('modal-title').textContent = '🎭 Новый спектакль'; ['new-title', 'new-desc', 'new-date', 'new-time'].forEach(i => document.getElementById(i).value = ''); document.getElementById('new-rows').value = '10'; document.getElementById('new-cols').value = '10'; document.getElementById('new-aisle').value = '0'; document.getElementById('show-poster').value = ''; document.getElementById('poster-preview').style.display = 'none'; document.getElementById('new-venue').value = ''; };
window.closeCreateShowModal = () => window.closeModal('create-show-modal');
window.editShow = id => { const s = showsCache.find(x => x.id === id); if (!s) return; currentEditShowId = id; window.openModal('create-show-modal'); document.getElementById('modal-title').textContent = '✏️ Редактирование'; document.getElementById('new-title').value = s.title || ''; document.getElementById('new-desc').value = s.description || ''; document.getElementById('new-date').value = s.date || ''; document.getElementById('new-time').value = s.time || ''; document.getElementById('new-rows').value = s.layout_rows || 10; document.getElementById('new-cols').value = s.layout_cols || 10; document.getElementById('new-aisle').value = s.aisle_after_col ? String(s.aisle_after_col).replace(/\s/g, '') : '0'; const p = document.getElementById('poster-preview'); if (s.poster) { p.src = s.poster; p.style.display = 'block'; } else p.style.display = 'none'; document.getElementById('new-venue').value = s.venue_address || ''; };
window.submitCreateShow = async () => { const t = document.getElementById('new-title').value.trim(), d = document.getElementById('new-date').value, tm = document.getElementById('new-time').value; if (!t || !d || !tm) return alert('Заполните поля'); const btn = document.querySelector('#create-show-modal .btn.primary'); btn.textContent = 'Сохранение...'; btn.disabled = true; try { let p64 = null; const f = document.getElementById('show-poster'); if (f && f.files[0]) p64 = await new Promise(r => { const rd = new FileReader(); rd.onloadend = () => r(rd.result); rd.readAsDataURL(f.files[0]); }); const pay = { title: t, description: document.getElementById('new-desc').value, date: d, time: tm, venue_address: document.getElementById('new-venue').value.trim(), rows: parseInt(document.getElementById('new-rows').value) || 10, cols: parseInt(document.getElementById('new-cols').value) || 10, aisle_after_col: document.getElementById('new-aisle').value.trim(), table_layout: JSON.stringify(tableMap || {}) }; if (p64) pay.poster = p64; const isE = !!currentEditShowId, url = isE ? `${API}/admin/shows/${currentEditShowId}` : `${API}/admin/shows`, met = isE ? 'PATCH' : 'POST'; const r = await fetch(url, { method: met, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(pay) }); if (!r.ok) throw new Error(await r.text()); alert(isE ? '✅ Обновлён' : '✅ Создан'); window.closeCreateShowModal(); window.loadShows(); } catch (e) { alert('❌ ' + e.message); } finally { btn.textContent = currentEditShowId ? 'Сохранить' : 'Создать'; btn.disabled = false; } };
window.deleteShow = async id => { if (!confirm('Удалить?')) return; try { const r = await fetch(`${API}/admin/shows/${id}`, { method: 'DELETE' }); if (!r.ok) throw new Error(await r.text()); if (currentShowId === id) { currentShowId = null; document.getElementById('bookings-section').style.display = 'none'; } window.loadShows(); } catch (e) { alert('❌ ' + e.message); } };