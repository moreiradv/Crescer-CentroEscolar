let libraryBooks = [], currentLibraryBook = null;

const libraryValue = value => value === null || value === undefined || value === '' ? 'Não informado' : String(value);

function filteredLibraryBooks() {
  const query = $('#librarySearch').value.trim().toLowerCase();
  return libraryBooks.filter(book => !query || `${book.title} ${book.author || ''}`.toLowerCase().includes(query));
}

function renderLibraryBooks() {
  const books = filteredLibraryBooks();
  $('#libraryBookCount').textContent = libraryBooks.length;
  $('#libraryNavCount').textContent = libraryBooks.length;
  $('#libraryListCount').textContent = books.length;
  $('#libraryGrid').innerHTML = books.length ? books.map(book => `<article class="library-book-card text-only" data-library-detail="${book.id}" tabindex="0" role="button" aria-label="Ver detalhes de ${esc(book.title)}"><div class="library-text-icon">▥</div><div class="library-card-copy"><span>${esc(book.accession_code)}</span><h3>${esc(book.title)}</h3><p>${esc(book.author || 'Autor não informado')}</p><small>${esc(book.publisher || 'Editora não informada')}${book.publication_year ? ` • ${book.publication_year}` : ''}</small></div></article>`).join('') : '<article class="panel empty-state library-empty">Nenhum livro encontrado. A Biblioteca será preenchida pela própria escola.</article>';
  $('#libraryTable').innerHTML = books.length ? books.map(book => `<tr><td><strong>${esc(book.accession_code)}</strong></td><td>${esc(book.title)}</td><td>${esc(book.author || '—')}</td><td>${esc(book.publisher || '—')}</td><td>${book.publication_year || '—'}</td><td>${book.quantity ?? '—'}</td><td><button class="table-action" data-library-detail="${book.id}">Detalhes</button>${manager() ? ` <button class="table-action" data-library-edit="${book.id}">Editar</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty-cell">Nenhum livro cadastrado ou encontrado nesta pesquisa.</td></tr>';
}

async function loadLibraryBooks(silent = false) {
  try { const data = await api('/api/library-books'); libraryBooks = data.books; renderLibraryBooks(); }
  catch (error) { if (!silent) toast('Erro ao carregar a Biblioteca', error.message); }
}

function openLibraryBook(book = null) {
  if (!manager()) return toast('Acesso restrito', 'Seu perfil pode consultar a Biblioteca, mas não alterar o acervo.');
  currentLibraryBook = book; $('#libraryBookForm').reset(); $('#libraryBookId').value = book?.id || '';
  $('#libraryTitle').value = book?.title || ''; $('#libraryAuthor').value = book?.author || ''; $('#libraryPublisher').value = book?.publisher || ''; $('#libraryYear').value = book?.publication_year || ''; $('#libraryAgeRange').value = book?.age_range || ''; $('#libraryQuantity').value = book?.quantity ?? ''; $('#librarySynopsis').value = book?.synopsis || ''; $('#libraryNotes').value = book?.notes || '';
  $('#libraryModalLabel').textContent = book ? book.accession_code : 'Novo cadastro'; $('#libraryModalTitle').textContent = book ? 'Editar Livro' : 'Cadastrar Livro'; $('#deleteLibraryBookBtn').classList.toggle('hidden', !book); $('#libraryFormError').classList.add('hidden'); $('#libraryBookModal').showModal();
}

function showLibraryDetails(book) {
  currentLibraryBook = book; $('#libraryDetailCode').textContent = book.accession_code; $('#libraryDetailTitle').textContent = book.title; $('#libraryDetailAuthor').textContent = book.author || 'Autor não informado';
  $('#libraryDetailContent').innerHTML = `<div class="library-detail-info full"><section><h3>Sinopse</h3><p>${esc(book.synopsis || 'Sinopse não cadastrada.')}</p></section><dl><div><dt>Editora</dt><dd>${esc(libraryValue(book.publisher))}</dd></div><div><dt>Ano de publicação</dt><dd>${esc(libraryValue(book.publication_year))}</dd></div><div><dt>Faixa etária</dt><dd>${esc(libraryValue(book.age_range))}</dd></div><div><dt>Exemplares</dt><dd>${esc(libraryValue(book.quantity))}</dd></div></dl><section><h3>Observações</h3><p>${esc(book.notes || 'Nenhuma observação cadastrada.')}</p></section></div>`;
  $('#editLibraryFromDetail').classList.toggle('hidden', !manager()); $('#libraryDetailModal').showModal();
}

$('#librarySearch').addEventListener('input', renderLibraryBooks);
$('#newLibraryBookBtn').onclick = () => openLibraryBook();

function libraryClickHandler(event) {
  const edit = event.target.closest('[data-library-edit]'), detail = event.target.closest('[data-library-detail]');
  if (edit) { event.stopPropagation(); return openLibraryBook(libraryBooks.find(book => book.id === Number(edit.dataset.libraryEdit))); }
  if (detail) showLibraryDetails(libraryBooks.find(book => book.id === Number(detail.dataset.libraryDetail)));
}
$('#libraryGrid').onclick = libraryClickHandler; $('#libraryTable').onclick = libraryClickHandler;
$('#libraryGrid').onkeydown = event => { if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-library-detail]')) { event.preventDefault(); showLibraryDetails(libraryBooks.find(book => book.id === Number(event.target.dataset.libraryDetail))); } };

$('#libraryBookForm').onsubmit = async event => {
  event.preventDefault(); const form = event.currentTarget; if (!form.reportValidity()) return; const box = $('#libraryFormError'); box.classList.add('hidden');
  const id = Number($('#libraryBookId').value) || 0;
  const payload = { title: $('#libraryTitle').value, author: $('#libraryAuthor').value, synopsis: $('#librarySynopsis').value, publisher: $('#libraryPublisher').value, publicationYear: $('#libraryYear').value, ageRange: $('#libraryAgeRange').value, quantity: $('#libraryQuantity').value, notes: $('#libraryNotes').value };
  try {
    await api(id ? `/api/library-books/${id}` : '/api/library-books', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
    $('#libraryBookModal').close(); await loadLibraryBooks(); toast(id ? 'Livro atualizado' : 'Livro cadastrado', 'O registro textual foi salvo no acervo.');
  } catch (error) { box.textContent = error.message; box.classList.remove('hidden'); }
};

$('#deleteLibraryBookBtn').onclick = async () => {
  const id = Number($('#libraryBookId').value); if (!id || !confirm('Excluir este livro permanentemente?')) return;
  try { await api(`/api/library-books/${id}`, { method: 'DELETE' }); $('#libraryBookModal').close(); await loadLibraryBooks(); toast('Livro excluído', 'O registro foi removido do acervo.'); }
  catch (error) { $('#libraryFormError').textContent = error.message; $('#libraryFormError').classList.remove('hidden'); }
};

const closeLibraryDetail = () => $('#libraryDetailModal').close();
$('#closeLibraryDetail').onclick = closeLibraryDetail; $('#closeLibraryDetailBottom').onclick = closeLibraryDetail;
$('#editLibraryFromDetail').onclick = () => { const book = currentLibraryBook; closeLibraryDetail(); openLibraryBook(book); };
