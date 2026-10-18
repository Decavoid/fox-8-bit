// Render the popup in the page: Firefox's native select popup cannot use @font-face.
export function enhanceStatusSelect(select) {
  const wrapper = document.createElement('div');
  wrapper.className = 'status-select';
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.id = `${select.id}-trigger`;
  trigger.className = 'status-select-trigger';
  trigger.setAttribute('role', 'combobox');
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  const list = document.createElement('ul');
  list.id = `${select.id}-options`;
  list.className = 'status-select-options';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  trigger.setAttribute('aria-controls', list.id);
  const label = select.labels[0];
  label.id ||= `${select.id}-label`;
  label.htmlFor = trigger.id;
  trigger.setAttribute('aria-labelledby', label.id);
  list.setAttribute('aria-labelledby', label.id);
  const options = Array.from(select.options, (option, index) => {
    const item = document.createElement('li');
    item.id = `${select.id}-option-${index}`;
    item.setAttribute('role', 'option');
    item.textContent = option.textContent;
    list.append(item);
    return item;
  });
  wrapper.append(trigger, list);
  select.after(wrapper);
  select.hidden = true;

  let activeIndex = select.selectedIndex;
  let search = '';
  let lastTyped = 0;

  function highlight(index) {
    activeIndex = index;
    options.forEach((option, i) => {
      option.classList.toggle('is-active', !list.hidden && i === activeIndex);
      option.setAttribute('aria-selected', String(i === select.selectedIndex));
    });
    if (!list.hidden) trigger.setAttribute('aria-activedescendant', options[index].id);
  }

  function sync() {
    trigger.textContent = select.selectedOptions[0].textContent;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-activedescendant');
    search = '';
    highlight(select.selectedIndex);
  }

  function open() {
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    highlight(select.selectedIndex);
  }

  function close(commit = false) {
    const changed = commit && select.selectedIndex !== activeIndex;
    if (commit) select.selectedIndex = activeIndex;
    sync();
    if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
  }

  trigger.addEventListener('click', () => list.hidden ? open() : close());
  trigger.addEventListener('keydown', event => {
    if (event.ctrlKey || event.metaKey || (event.altKey && !['ArrowDown', 'ArrowUp'].includes(event.key))) return;
    if (event.key === 'Tab') { if (!list.hidden) close(true); return; }
    if (event.key === 'Escape') {
      if (!list.hidden) { event.preventDefault(); close(); }
      return;
    }
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (list.hidden) open(); else close(true);
      return;
    }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const wasOpen = !list.hidden;
      if (!wasOpen) open();
      if (event.altKey) { if (wasOpen && event.key === 'ArrowUp') close(true); return; }
      if (event.key === 'Home') highlight(0);
      else if (event.key === 'End') highlight(options.length - 1);
      else if (wasOpen) highlight(Math.max(0, Math.min(options.length - 1, activeIndex + (event.key === 'ArrowDown' ? 1 : -1))));
      return;
    }
    if (event.key.length === 1) {
      event.preventDefault();
      if (list.hidden) open();
      const now = Date.now();
      search = now - lastTyped > 700 ? event.key : search + event.key;
      lastTyped = now;
      const letters = search.toLocaleLowerCase('ru');
      const prefix = [...letters].every(letter => letter === letters[0]) ? letters[0] : letters;
      const start = prefix.length === 1 ? activeIndex + 1 : activeIndex;
      for (let offset = 0; offset < options.length; offset++) {
        const index = (start + offset) % options.length;
        if (options[index].textContent.toLocaleLowerCase('ru').startsWith(prefix)) { highlight(index); break; }
      }
    }
  });
  // Keep DOM focus on the combobox until a pointer selection is committed.
  list.addEventListener('pointerdown', event => event.preventDefault());
  options.forEach((option, index) => {
    option.addEventListener('click', () => { highlight(index); close(true); trigger.focus(); });
  });
  trigger.addEventListener('blur', () => { if (!list.hidden) close(true); });
  document.addEventListener('pointerdown', event => {
    if (!wrapper.contains(event.target) && !list.hidden) close();
  });
  select.addEventListener('change', sync);
  sync();
  return { sync };
}
