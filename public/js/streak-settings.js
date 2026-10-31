/* Draft form stays local until Apply; state pushes must not erase typing. */
export function mountStreakSettings(form, apply) {
  const enabled = form.elements.enabled;
  const fieldset = form.querySelector('fieldset');
  const fields = form.querySelector('[data-chances]');
  const hint = form.querySelector('[data-hint]');
  const status = form.querySelector('[data-status]');
  const buttons = [...form.querySelectorAll('[data-preset]')];
  const summaryState = form.closest('details').querySelector('[data-streak-summary]');
  let savedLabel = 'Подключение…';
  let dirty = false, busy = false, locked = true, customMode = false;
  const values = () => [...fields.querySelectorAll('input')].map(input => input.valueAsNumber);
  const presets = { standard: [40, 25, 10], strong: [35, 15, 3] };

  function setValues(chances) {
    fields.replaceChildren();
    chances.forEach((chance, i) => {
      const row = document.createElement('div');
      row.className = 'streak-probability';
      const label = document.createElement('label');
      label.htmlFor = `streak-chance-${i}`;
      label.textContent = i === chances.length - 1
        ? `После ${i + 1} и более побед` : `После ${i + 1} ${i === 0 ? 'победы' : 'побед'} подряд`;
      const unit = document.createElement('span');
      const input = document.createElement('input');
      Object.assign(input, { id: label.htmlFor, type: 'number', min: '1', max: '99', step: '1', required: true, value: chance });
      unit.append(input, ' %');
      row.append(label, unit);
      fields.append(row);
    });
  }

  function update() {
    summaryState.textContent = dirty ? 'Есть изменения' : savedLabel;
    summaryState.classList.toggle('pending', dirty);
    fieldset.disabled = locked || busy;
    const chances = values();
    for (const input of fields.querySelectorAll('input')) input.disabled = !enabled.checked;
    for (const button of buttons) {
      button.disabled = !enabled.checked;
      const matches = JSON.stringify(chances) === JSON.stringify(presets[button.dataset.preset]);
      button.setAttribute('aria-pressed', String(button.dataset.preset === 'custom'
        ? customMode || !Object.values(presets).some(p => JSON.stringify(p) === JSON.stringify(chances)) : !customMode && matches));
    }
    form.querySelector('[data-enabled-label]').textContent = enabled.checked ? 'Включена' : 'Выключена';
    const last = chances.at(-1);
    hint.textContent = !enabled.checked ? 'Каждый бой — 50/50, независимо от предыдущих побед.'
      : chances.some(p => !Number.isInteger(p) || p < 1 || p > 99) ? 'Укажите целые проценты от 1 до 99.'
      : `После ${chances.length} побед шанс ещё одной — ${last}%. У соперника — ${100 - last}%.`;
    form.querySelector('[data-lock-note]').hidden = !locked;
    form.querySelector('[type=submit]').disabled = busy || locked || !dirty;
  }

  form.addEventListener('input', event => {
    if (event.target.type === 'number') customMode = true;
    dirty = true;
    status.textContent = 'Есть изменения'; status.classList.remove('bad'); update();
  });
  buttons.forEach(button => button.addEventListener('click', () => {
    customMode = button.dataset.preset === 'custom';
    if (presets[button.dataset.preset]) setValues(presets[button.dataset.preset]);
    dirty = true; status.textContent = 'Есть изменения'; status.classList.remove('bad'); update();
  }));
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (locked || busy || !form.reportValidity()) return;
    const chances = enabled.checked ? values() : [];
    busy = true; status.textContent = 'Сохранение…'; update();
    try {
      const result = await apply(chances);
      if (!result.ok) throw new Error(result.error || 'Не удалось сохранить настройки');
      dirty = false; customMode = false; status.textContent = 'Сохранено'; status.classList.remove('bad');
    } catch (e) {
      status.textContent = e.message; status.classList.add('bad');
    } finally { busy = false; update(); }
  });

  setValues(presets.standard); update();
  return {
    render(session) {
      locked = !['idle', 'result', 'pause'].includes(session.phase);
      if (Array.isArray(session.antiStreak)) {
        const incoming = session.antiStreak;
        const key = Object.keys(presets).find(name => JSON.stringify(presets[name]) === JSON.stringify(incoming));
        savedLabel = !incoming.length ? 'Выключена' : key === 'standard' ? 'Стандартная' : key === 'strong' ? 'Усиленная' : 'Своя';
      }
      if (!dirty && !busy && Array.isArray(session.antiStreak)) {
        const incoming = session.antiStreak;
        enabled.checked = incoming.length > 0;
        if (incoming.length && JSON.stringify(values()) !== JSON.stringify(incoming)) setValues(incoming);
      }
      update();
    },
  };
}
