document.addEventListener('click', event => {
  const button = event.target.closest('.focusNotesBtn');
  if (!button) return;
  const stage = button.closest('.presentationStage');
  const expanded = stage.classList.toggle('notesFocused');
  button.setAttribute('aria-pressed', String(expanded));
  button.textContent = expanded ? 'Show project details' : 'Expand comments';
  const viewport = stage.closest('.presentationViewport');
  if (viewport) viewport.scrollTop = 0;
});
