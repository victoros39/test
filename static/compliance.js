/**
 * 🔒 Модуль соответствия 152-ФЗ / GDPR
 * Показывает баннер о cookies и ссылку на Политику конфиденциальности
 */
document.addEventListener('DOMContentLoaded', () => {
  // Проверяем, принял ли пользователь cookies
  if (localStorage.getItem('cookies_accepted')) return;

  // Создаём баннер
  const banner = document.createElement('div');
  banner.id = 'cookies-banner';
  banner.style.cssText = `
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    background: #1e293b;
    color: #fff;
    padding: 14px 20px;
    display: flex;
    flex-wrap: wrap;
    justify-content: space-between;
    align-items: center;
    gap: 12px;
    z-index: 9999;
    font-size: 0.9rem;
    line-height: 1.4;
    box-shadow: 0 -2px 12px rgba(0,0,0,0.15);
  `;

  banner.innerHTML = `
    <span style="flex:1; min-width:200px;">
      Мы используем технические cookies для работы сайта. 
      <a href="/static/privacy.html" target="_blank" style="color:#818cf8; text-decoration:none; font-weight:500;">Политика конфиденциальности</a>
    </span>
    <button id="accept-cookies" style="
      background: #6c5ce7;
      color: #fff;
      border: none;
      padding: 8px 20px;
      border-radius: 8px;
      cursor: pointer;
      font-weight: 600;
      font-size: 0.9rem;
      transition: 0.2s;
      white-space: nowrap;
    ">Принять</button>
  `;

  // Добавляем баннер в конец body
  document.body.appendChild(banner);

  // Обработчик кнопки "Принять"
  const btn = document.getElementById('accept-cookies');
  if (btn) {
    btn.onclick = () => {
      localStorage.setItem('cookies_accepted', 'true');
      // Плавное скрытие
      banner.style.transition = 'opacity 0.3s, transform 0.3s';
      banner.style.opacity = '0';
      banner.style.transform = 'translateY(10px)';
      setTimeout(() => banner.remove(), 300);
    };
  }
});

/**
 * Утилита: получить согласие пользователя (для использования в других скриптах)
 * @returns {boolean} true, если пользователь принял cookies
 */
window.hasCookiesConsent = () => localStorage.getItem('cookies_accepted') === 'true';