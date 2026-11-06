const API_URL = (window.APP_CONFIG?.apiUrl || "").replace(/\/$/, "");
const $ = (id) => document.getElementById(id);
const noteForm = $("note-form"), titleInput = $("title"), explanationInput = $("explanation"), tagInput = $("tag");
const saveNoteButton = $("save-note"), notesElement = $("notes"), messageElement = $("message");
const loadingElement = $("loading"), emptyStateElement = $("empty-state"), noteCountElement = $("note-count");
const connectionStatusElement = $("connection-status"), explanationCountElement = $("explanation-count");

function el(tag, text = "", className = "") { const x = document.createElement(tag); x.textContent = text; x.className = className; return x; }
function button(text, className = "button button--secondary") { const x = el("button", text, className); x.type = "button"; return x; }
function textarea(value, placeholder, rows = 4) { const x = document.createElement("textarea"); x.value = value || ""; x.placeholder = placeholder; x.rows = rows; x.maxLength = 3000; return x; }
function showMessage(text, type = "info") { messageElement.textContent = text; messageElement.hidden = false; messageElement.className = `message ${type === "error" ? "is-error" : type === "success" ? "is-success" : ""}`; clearTimeout(showMessage.timer); showMessage.timer = setTimeout(() => messageElement.hidden = true, 5000); }
function busy(btn, on, text) { if (on) { btn.dataset.text = btn.textContent; btn.textContent = text; btn.disabled = true; } else { btn.textContent = btn.dataset.text || btn.textContent; btn.disabled = false; } }
async function api(path, options = {}) { if (!API_URL) throw new Error("API URLが設定されていません。"); const r = await fetch(API_URL + path, {...options, headers: {"Content-Type": "application/json", ...(options.headers || {})}}); const data = await r.json().catch(() => ({})); if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`); return data; }
function formatDate(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "" : new Intl.DateTimeFormat("ja-JP", {year:"numeric",month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}).format(d); }

async function loadNotes() {
  loadingElement.hidden = false; notesElement.hidden = true; emptyStateElement.hidden = true;
  try { const data = await api("/notes"); const notes = Array.isArray(data.notes) ? data.notes : []; renderNotes(notes); noteCountElement.textContent = `${notes.length}件`; emptyStateElement.hidden = notes.length > 0; connectionStatusElement.className = "status-badge is-connected"; connectionStatusElement.lastChild.textContent = " 接続済み"; }
  catch (error) { showMessage(error.message, "error"); connectionStatusElement.className = "status-badge is-error"; connectionStatusElement.lastChild.textContent = " 接続エラー"; }
  finally { loadingElement.hidden = true; notesElement.hidden = false; }
}

function renderQa(note, qa) {
  const box = el("section", "", "qa-item");
  const head = el("div", "", "qa-item__header"); head.append(el("span", "AIからの確認質問", "panel-label"));
  const del = button("このQ&Aを削除", "button button--danger button--small"); head.append(del); box.append(head, el("p", qa.question || "", "qa-question"));
  del.onclick = async () => { if (!confirm("このQ&Aを削除しますか？")) return; try { busy(del,true,"削除中..."); await api(`/notes/${note.note_id}/questions/${qa.qa_id}`, {method:"DELETE"}); await loadNotes(); } catch(e) { showMessage(e.message,"error"); busy(del,false); } };
  const answer = textarea(qa.answer, "質問への回答を自分の言葉で入力してください。"); const check = button(qa.feedback ? "回答を再確認" : "回答を確認", "button button--primary"); const editor = el("div","","answer-editor"); editor.append(answer, check); box.append(editor);
  check.onclick = async () => { if (!answer.value.trim()) return showMessage("回答を入力してください。","error"); try { busy(check,true,"AIが確認中..."); await api(`/notes/${note.note_id}/questions/${qa.qa_id}/answer`, {method:"POST",body:JSON.stringify({answer:answer.value.trim()})}); await loadNotes(); } catch(e) { showMessage(e.message,"error"); busy(check,false); } };
  if (qa.feedback) { const f = el("div","","feedback-panel"); f.append(el("span","AIフィードバック","panel-label"), el("p",qa.feedback)); box.append(f); }
  const memo = el("div","","learning-memo"), memoInput = textarea(qa.learning_memo,"AIフィードバックをもとに、気づきや復習内容を記入してください。",3), saveMemo = button("学習メモを保存"); memo.append(el("span","学習メモ","panel-label"),memoInput,saveMemo); box.append(memo);
  saveMemo.onclick = async () => { try { busy(saveMemo,true,"保存中..."); await api(`/notes/${note.note_id}/questions/${qa.qa_id}/memo`, {method:"PUT",body:JSON.stringify({learning_memo:memoInput.value})}); showMessage("学習メモを保存しました。","success"); } catch(e) { showMessage(e.message,"error"); } finally { busy(saveMemo,false); } };
  return box;
}

function renderNotes(notes) {
  notesElement.textContent = "";
  notes.forEach(note => {
    const card = el("article","","note-card"), display = el("div"), header = el("div","","note-card__header"), group = el("div","","note-card__title-group");
    group.append(el("h3",note.title || "無題"), el("div",formatDate(note.updated_at || note.created_at),"note-card__date"));
    const actions = el("div","","note-header-actions"), edit = button("編集"), del = button("削除","button button--danger"); actions.append(edit,del); header.append(group,actions); display.append(header);
    if (note.tag) display.append(el("span",`# ${note.tag}`,"tag")); display.append(el("p",note.explanation || "","note-card__explanation")); card.append(display);
    const form = el("div","","note-edit-panel"); form.hidden = true; const et = document.createElement("input"), ee = textarea(note.explanation,"自分の説明",7), eg = document.createElement("input"); et.value=note.title||""; et.maxLength=100; eg.value=note.tag||""; eg.maxLength=30;
    [["タイトル",et],["自分の説明",ee],["タグ",eg]].forEach(([label,input])=>{const field=el("div","","field");field.append(el("label",label),input);form.append(field);}); const save=button("変更を保存","button button--primary"), cancel=button("キャンセル"), fa=el("div","","note-actions");fa.append(save,cancel);form.append(fa);card.append(form);
    edit.onclick=()=>{display.hidden=true;form.hidden=false;et.focus();}; cancel.onclick=()=>{form.hidden=true;display.hidden=false;};
    save.onclick=async()=>{if(!et.value.trim()||!ee.value.trim())return showMessage("タイトルと自分の説明を入力してください。","error");try{busy(save,true,"保存中...");await api(`/notes/${note.note_id}`,{method:"PUT",body:JSON.stringify({title:et.value.trim(),explanation:ee.value.trim(),tag:eg.value.trim()})});await loadNotes();}catch(e){showMessage(e.message,"error");busy(save,false);}};
    del.onclick=async()=>{if(!confirm(`「${note.title||"無題"}」を削除しますか？`))return;try{await api(`/notes/${note.note_id}`,{method:"DELETE"});await loadNotes();}catch(e){showMessage(e.message,"error");}};
    const history=Array.isArray(note.qa_history)?note.qa_history:[]; history.forEach(qa=>card.append(renderQa(note,qa)));
    const ask=button(history.length?"別の質問を作る":"AIに質問してもらう"), bottom=el("div","","note-actions");bottom.append(ask);card.append(bottom);
    ask.onclick=async()=>{try{busy(ask,true,"AIが質問を作成中...");await api(`/notes/${note.note_id}/question`,{method:"POST",body:"{}"});await loadNotes();}catch(e){showMessage(e.message,"error");busy(ask,false);}};
    notesElement.append(card);
  });
}

noteForm.addEventListener("submit", async event => { event.preventDefault(); if(!titleInput.value.trim()||!explanationInput.value.trim())return showMessage("タイトルと自分の説明を入力してください。","error"); try{busy(saveNoteButton,true,"保存中...");await api("/notes",{method:"POST",body:JSON.stringify({title:titleInput.value.trim(),explanation:explanationInput.value.trim(),tag:tagInput.value.trim()})});noteForm.reset();explanationCountElement.textContent="0 / 3000";await loadNotes();}catch(e){showMessage(e.message,"error");}finally{busy(saveNoteButton,false);}});
$("clear-form").onclick=()=>{noteForm.reset();explanationCountElement.textContent="0 / 3000";titleInput.focus();};
$("focus-form").onclick=()=>{$("new-note").scrollIntoView({behavior:"smooth"});setTimeout(()=>titleInput.focus(),350);};
explanationInput.oninput=()=>explanationCountElement.textContent=`${explanationInput.value.length} / 3000`;
$("reload").onclick=loadNotes;
loadNotes();
