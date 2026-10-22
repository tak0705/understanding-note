const API_URL = (
  window.APP_CONFIG?.apiUrl || ""
).replace(/\/$/, "");

const noteForm = document.getElementById("note-form");
const titleInput = document.getElementById("title");
const explanationInput = document.getElementById("explanation");
const tagInput = document.getElementById("tag");
const saveNoteButton = document.getElementById("save-note");
const clearFormButton = document.getElementById("clear-form");
const focusFormButton = document.getElementById("focus-form");

const notesElement = document.getElementById("notes");
const messageElement = document.getElementById("message");
const loadingElement = document.getElementById("loading");
const emptyStateElement = document.getElementById("empty-state");
const noteCountElement = document.getElementById("note-count");
const connectionStatusElement =
  document.getElementById("connection-status");
const explanationCountElement =
  document.getElementById("explanation-count");


function showMessage(text, type = "info") {
  messageElement.textContent = text;
  messageElement.hidden = false;

  messageElement.classList.remove(
    "is-error",
    "is-success"
  );

  if (type === "error") {
    messageElement.classList.add("is-error");
  }

  if (type === "success") {
    messageElement.classList.add("is-success");
  }

  window.clearTimeout(showMessage.timeoutId);

  showMessage.timeoutId = window.setTimeout(() => {
    messageElement.hidden = true;
  }, 5000);
}


function setConnectionStatus(status) {
  connectionStatusElement.classList.remove(
    "is-connected",
    "is-error"
  );

  if (status === "connected") {
    connectionStatusElement.classList.add("is-connected");
    connectionStatusElement.lastChild.textContent = " 接続済み";
    return;
  }

  if (status === "error") {
    connectionStatusElement.classList.add("is-error");
    connectionStatusElement.lastChild.textContent = " 接続エラー";
    return;
  }

  connectionStatusElement.lastChild.textContent = " 接続確認中";
}


function setLoading(isLoading) {
  loadingElement.hidden = !isLoading;

  if (isLoading) {
    emptyStateElement.hidden = true;
    notesElement.hidden = true;
  } else {
    notesElement.hidden = false;
  }
}


async function apiRequest(path, options = {}) {
  if (!API_URL) {
    throw new Error(
      "API URLが設定されていません。frontend/config.jsを確認してください。"
    );
  }

  const response = await fetch(
    `${API_URL}${path}`,
    {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {})
      }
    }
  );

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "APIから正しいJSON応答を取得できませんでした。"
    );
  }

  if (!response.ok) {
    throw new Error(
      data.message ||
      `APIエラーが発生しました。HTTP ${response.status}`
    );
  }

  return data;
}


function createElement(tagName, options = {}) {
  const element = document.createElement(tagName);

  if (options.className) {
    element.className = options.className;
  }

  if (options.text !== undefined) {
    element.textContent = options.text;
  }

  if (options.type) {
    element.type = options.type;
  }

  return element;
}


function formatDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "ja-JP",
    {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(date);
}


function setButtonLoading(button, isLoading, loadingText) {
  if (isLoading) {
    button.dataset.originalText = button.textContent;
    button.textContent = loadingText;
    button.disabled = true;
    return;
  }

  button.textContent =
    button.dataset.originalText || button.textContent;

  button.disabled = false;
}


async function loadNotes() {
  setLoading(true);
  setConnectionStatus("checking");

  try {
    const data = await apiRequest("/notes");
    const notes = Array.isArray(data.notes) ? data.notes : [];

    renderNotes(notes);
    noteCountElement.textContent = `${notes.length}件`;
    emptyStateElement.hidden = notes.length !== 0;

    setConnectionStatus("connected");
  } catch (error) {
    notesElement.textContent = "";
    noteCountElement.textContent = "0件";
    emptyStateElement.hidden = true;

    setConnectionStatus("error");
    showMessage(error.message, "error");
  } finally {
    setLoading(false);
  }
}


function renderNotes(notes) {
  notesElement.textContent = "";

  notes.forEach((note) => {
    const article = createElement(
      "article",
      {
        className: "note-card"
      }
    );

    const header = createElement(
      "div",
      {
        className: "note-card__header"
      }
    );

    const titleGroup = createElement(
      "div",
      {
        className: "note-card__title-group"
      }
    );

    const title = createElement(
      "h3",
      {
        text: note.title || "無題"
      }
    );
 createElement(
      "div",
      {
        className: "note-card__date",
        text: formatDate(note.created_at)
      }
    );

    titleGroup.append(title);

    const deleteButton = createElement(
      "button",
      {
        className: "button button--danger",
        text: "削除",
        type: "button"
      }
    );

    deleteButton.setAttribute(
      "aria-label",
      `${note.title || "メモ"}を削除`
    );

    deleteButton.addEventListener(
      "click",
      async () => {
        const shouldDelete = window.confirm(
          `「${note.title || "無題"}」を削除しますか？`
        );

        if (!shouldDelete) {
          return;
        }

        try {
          setButtonLoading(
            deleteButton,
            true,
            "削除中"
          );

          await apiRequest(
            `/notes/${note.note_id}`,
            {
              method: "DELETE"
            }
          );

          showMessage(
            "メモを削除しました。",
            "success"
          );

          await loadNotes();
        } catch (error) {
          showMessage(error.message, "error");

          setButtonLoading(
            deleteButton,
            false
          );
        }
      }
    );

    header.append(titleGroup, deleteButton);
    article.appendChild(header);

    if (note.tag) {
      const tag = createElement(
        "span",
        {
          className: "tag",
          text: `# ${note.tag}`
        }
      );

      article.appendChild(tag);
    }

    const explanation = createElement(
      "p",
      {
        className: "note-card__explanation",
        text: note.explanation || ""
      }
    );

    article.appendChild(explanation);

    if (note.question) {
      const questionPanel = createElement(
        "div",
        {
          className: "question-panel"
        }
      );

      const questionLabel = createElement(
        "span",
        {
          className: "panel-label",
          text: "AIからの確認質問"
        }
      );

      const questionText = createElement(
        "p",
        {
          text: note.question
        }
      );

      questionPanel.append(
        questionLabel,
        questionText
      );

      const answerEditor = createElement(
        "div",
        {
          className: "answer-editor"
        }
      );

      const answerInput =
        document.createElement("textarea");

      answerInput.rows = 4;
      answerInput.maxLength = 3000;
      answerInput.placeholder =
        "質問への回答を自分の言葉で入力してください。";
      answerInput.value = note.answer || "";

      const answerButton = createElement(
        "button",
        {
          className: "button button--primary",
          text: "回答を確認",
          type: "button"
        }
      );

      answerButton.addEventListener(
        "click",
        async () => {
          const answer = answerInput.value.trim();

          if (!answer) {
            showMessage(
              "回答を入力してください。",
              "error"
            );

            answerInput.focus();
            return;
          }

          try {
            setButtonLoading(
              answerButton,
              true,
              "AIが確認中..."
            );

            await apiRequest(
              `/notes/${note.note_id}/answer`,
              {
                method: "POST",
                body: JSON.stringify({
                  answer
                })
              }
            );

            showMessage(
              "回答を確認しました。",
              "success"
            );

            await loadNotes();
          } catch (error) {
            showMessage(error.message, "error");

            setButtonLoading(
              answerButton,
              false
            );
          }
        }
      );

      answerEditor.append(
        answerInput,
        answerButton
      );

      questionPanel.appendChild(answerEditor);
      article.appendChild(questionPanel);
    }

    if (note.feedback) {
      const feedbackPanel = createElement(
        "div",
        {
          className: "feedback-panel"
        }
      );

      const feedbackLabel = createElement(
        "span",
        {
          className: "panel-label",
          text: "AIフィードバック"
        }
      );

      const feedbackText = createElement(
        "p",
        {
          text: note.feedback
        }
      );

      feedbackPanel.append(
        feedbackLabel,
        feedbackText
      );

      article.appendChild(feedbackPanel);
    }

    const actions = createElement(
      "div",
      {
        className: "note-actions"
      }
    );

    const questionButton = createElement(
      "button",
      {
        className: "button button--secondary",
        text: note.question
          ? "別の質問を作る"
          : "AIに質問してもらう",
        type: "button"
      }
    );

    questionButton.addEventListener(
      "click",
      async () => {
        try {
          setButtonLoading(
            questionButton,
            true,
            "AIが質問を作成中..."
          );

          await apiRequest(
            `/notes/${note.note_id}/question`,
            {
              method: "POST",
              body: JSON.stringify({})
            }
          );

          showMessage(
            "確認質問を作成しました。",
            "success"
          );

          await loadNotes();
        } catch (error) {
          showMessage(error.message, "error");

          setButtonLoading(
            questionButton,
            false
          );
        }
      }
    );

    actions.appendChild(questionButton);
    article.appendChild(actions);
    notesElement.appendChild(article);
  });
}


noteForm.addEventListener(
  "submit",
  async (event) => {
    event.preventDefault();

    const title = titleInput.value.trim();
    const explanation = explanationInput.value.trim();
    const tag = tagInput.value.trim();

    if (!title || !explanation) {
      showMessage(
        "タイトルと自分の説明を入力してください。",
        "error"
      );

      return;
    }

    try {
      setButtonLoading(
        saveNoteButton,
        true,
        "保存中..."
      );

      await apiRequest(
        "/notes",
        {
          method: "POST",
          body: JSON.stringify({
            title,
            explanation,
            tag
          })
        }
      );

      noteForm.reset();
      explanationCountElement.textContent = "0 / 3000";

      showMessage(
        "メモを保存しました。",
        "success"
      );

      await loadNotes();
    } catch (error) {
      showMessage(error.message, "error");
    } finally {
      setButtonLoading(
        saveNoteButton,
        false
      );
    }
  }
);


clearFormButton.addEventListener(
  "click",
  () => {
    noteForm.reset();
    explanationCountElement.textContent = "0 / 3000";
    titleInput.focus();
  }
);


focusFormButton.addEventListener(
  "click",
  () => {
    document
      .getElementById("new-note")
      .scrollIntoView({
        behavior: "smooth",
        block: "start"
      });

    window.setTimeout(
      () => titleInput.focus(),
      350
    );
  }
);


explanationInput.addEventListener(
  "input",
  () => {
    explanationCountElement.textContent =
      `${explanationInput.value.length} / 3000`;
  }
);


document
  .getElementById("reload")
  .addEventListener(
    "click",
    loadNotes
  );


loadNotes();
