import json
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3

TABLE_NAME = os.environ["TABLE_NAME"]
MODEL_ID = os.environ["BEDROCK_MODEL_ID"]
table = boto3.resource("dynamodb").Table(TABLE_NAME)
bedrock = boto3.client("bedrock-runtime")


class DecimalEncoder(json.JSONEncoder):
    def default(self, value):
        if isinstance(value, Decimal):
            return int(value) if value % 1 == 0 else float(value)
        return super().default(value)


def response(status_code, body):
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(body, ensure_ascii=False, cls=DecimalEncoder),
    }


def parse_body(event):
    raw_body = event.get("body")
    if not raw_body:
        return {}
    try:
        return json.loads(raw_body)
    except json.JSONDecodeError as error:
        raise ValueError("JSONの形式が正しくありません。") from error


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def require_text(value, name, maximum):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name}を入力してください。")
    value = value.strip()
    if len(value) > maximum:
        raise ValueError(f"{name}は{maximum}文字以内で入力してください。")
    return value


def clean_question(value):
    value = str(value or "").strip()
    return re.sub(
        r"^\s*(?:\*{1,2})?\s*質問\s*[:：]?\s*(?:\*{1,2})?\s*",
        "",
        value,
        flags=re.IGNORECASE,
    ).strip()


def get_note(note_id):
    return table.get_item(Key={"note_id": note_id}).get("Item")


def invoke_bedrock(system_prompt, user_prompt, max_tokens=400):
    result = bedrock.converse(
        modelId=MODEL_ID,
        system=[{"text": system_prompt}],
        messages=[{"role": "user", "content": [{"text": user_prompt}]}],
        inferenceConfig={"maxTokens": max_tokens, "temperature": 0.2},
    )
    return "\n".join(
        item["text"]
        for item in result["output"]["message"]["content"]
        if "text" in item
    ).strip()


def normalize_note(note):
    history = note.get("qa_history")
    if isinstance(history, list):
        return note
    history = []
    if note.get("question"):
        stamp = note.get("updated_at") or note.get("created_at") or now_iso()
        history.append({
            "qa_id": f"legacy-{note['note_id']}",
            "question": clean_question(note.get("question")),
            "answer": note.get("answer", ""),
            "feedback": note.get("feedback", ""),
            "learning_memo": note.get("learning_memo", ""),
            "created_at": stamp,
            "updated_at": stamp,
        })
    table.update_item(
        Key={"note_id": note["note_id"]},
        UpdateExpression="SET qa_history = :history, updated_at = :updated",
        ExpressionAttributeValues={":history": history, ":updated": now_iso()},
    )
    note["qa_history"] = history
    return note


def save_history(note_id, history):
    table.update_item(
        Key={"note_id": note_id},
        UpdateExpression="SET qa_history = :history, updated_at = :updated",
        ExpressionAttributeValues={":history": history, ":updated": now_iso()},
    )


def find_qa(history, qa_id):
    return next((qa for qa in history if qa.get("qa_id") == qa_id), None)


def list_notes():
    items, args = [], {}
    while True:
        result = table.scan(**args)
        items.extend(result.get("Items", []))
        key = result.get("LastEvaluatedKey")
        if not key:
            break
        args["ExclusiveStartKey"] = key
    items = [normalize_note(item) for item in items]
    items.sort(key=lambda item: item.get("created_at", ""), reverse=True)
    return response(200, {"notes": items})


def create_note(event):
    body = parse_body(event)
    stamp = now_iso()
    item = {
        "note_id": str(uuid.uuid4()),
        "title": require_text(body.get("title"), "タイトル", 100),
        "explanation": require_text(body.get("explanation"), "自分の説明", 3000),
        "tag": str(body.get("tag", "")).strip()[:30],
        "qa_history": [],
        "created_at": stamp,
        "updated_at": stamp,
    }
    table.put_item(Item=item)
    return response(201, {"note": item})


def get_note_response(note_id):
    note = get_note(note_id)
    return response(200, {"note": normalize_note(note)}) if note else response(404, {"message": "メモが見つかりません。"})


def update_note(note_id, event):
    if not get_note(note_id):
        return response(404, {"message": "メモが見つかりません。"})
    body = parse_body(event)
    table.update_item(
        Key={"note_id": note_id},
        UpdateExpression="SET title=:title, explanation=:explanation, tag=:tag, updated_at=:updated",
        ExpressionAttributeValues={
            ":title": require_text(body.get("title"), "タイトル", 100),
            ":explanation": require_text(body.get("explanation"), "自分の説明", 3000),
            ":tag": str(body.get("tag", "")).strip()[:30],
            ":updated": now_iso(),
        },
    )
    return response(200, {"message": "メモを更新しました。"})


def delete_note(note_id):
    if not get_note(note_id):
        return response(404, {"message": "メモが見つかりません。"})
    table.delete_item(Key={"note_id": note_id})
    return response(200, {"message": "メモを削除しました。"})


def generate_question(note_id):
    note = get_note(note_id)
    if not note:
        return response(404, {"message": "メモが見つかりません。"})
    note = normalize_note(note)
    system_prompt = """あなたは学習者の理解を確認する質問者です。
学習者の説明から、理解を確認する日本語の質問を1問だけ作成してください。
質問本文だけを出力し、「質問:」「**質問:**」などの見出しは付けないでください。
短く分かりやすくし、理由、因果関係、内部動作のいずれかを確認してください。"""
    user_prompt = f"タイトル:\n{note['title']}\n\n学習者自身の説明:\n{note['explanation']}"
    question = clean_question(invoke_bedrock(system_prompt, user_prompt, 200))
    if not question:
        raise ValueError("質問を生成できませんでした。")
    stamp = now_iso()
    qa = {
        "qa_id": str(uuid.uuid4()), "question": question,
        "answer": "", "feedback": "", "learning_memo": "",
        "created_at": stamp, "updated_at": stamp,
    }
    note["qa_history"].append(qa)
    save_history(note_id, note["qa_history"])
    return response(200, {"qa": qa})


def evaluate_answer(note_id, qa_id, event):
    note = get_note(note_id)
    if not note:
        return response(404, {"message": "メモが見つかりません。"})
    note = normalize_note(note)
    qa = find_qa(note["qa_history"], qa_id)
    if not qa:
        return response(404, {"message": "質問が見つかりません。"})
    answer = require_text(parse_body(event).get("answer"), "回答", 3000)
    system_prompt = """回答を日本語で簡潔かつ穏やかに評価してください。
形式:
判定: 理解できています / 概ね理解できています / もう少し確認が必要です
理由: 1〜2文
補足: 必要な場合のみ1〜2文
不足がある場合は、不足点を具体的に伝えてください。"""
    user_prompt = f"タイトル:\n{note['title']}\n\n元の説明:\n{note['explanation']}\n\n確認質問:\n{qa['question']}\n\n学習者の回答:\n{answer}"
    feedback = invoke_bedrock(system_prompt, user_prompt, 400)
    qa.update(answer=answer, feedback=feedback, updated_at=now_iso())
    save_history(note_id, note["qa_history"])
    return response(200, {"answer": answer, "feedback": feedback})


def update_learning_memo(note_id, qa_id, event):
    note = get_note(note_id)
    if not note:
        return response(404, {"message": "メモが見つかりません。"})
    note = normalize_note(note)
    qa = find_qa(note["qa_history"], qa_id)
    if not qa:
        return response(404, {"message": "質問が見つかりません。"})
    value = str(parse_body(event).get("learning_memo", "")).strip()
    if len(value) > 3000:
        raise ValueError("学習メモは3000文字以内で入力してください。")
    qa.update(learning_memo=value, updated_at=now_iso())
    save_history(note_id, note["qa_history"])
    return response(200, {"message": "学習メモを保存しました。"})


def delete_question(note_id, qa_id):
    note = get_note(note_id)
    if not note:
        return response(404, {"message": "メモが見つかりません。"})
    note = normalize_note(note)
    history = [qa for qa in note["qa_history"] if qa.get("qa_id") != qa_id]
    if len(history) == len(note["qa_history"]):
        return response(404, {"message": "質問が見つかりません。"})
    save_history(note_id, history)
    return response(200, {"message": "Q&Aを削除しました。"})


def lambda_handler(event, context):
    try:
        method = event.get("requestContext", {}).get("http", {}).get("method", "")
        path = event.get("rawPath", "")
        params = event.get("pathParameters") or {}
        note_id, qa_id = params.get("id"), params.get("qa_id")
        if method == "GET" and path == "/notes": return list_notes()
        if method == "POST" and path == "/notes": return create_note(event)
        if method == "POST" and note_id and path.endswith("/question"): return generate_question(note_id)
        if method == "POST" and note_id and qa_id and path.endswith("/answer"): return evaluate_answer(note_id, qa_id, event)
        if method == "PUT" and note_id and qa_id and path.endswith("/memo"): return update_learning_memo(note_id, qa_id, event)
        if method == "DELETE" and note_id and qa_id: return delete_question(note_id, qa_id)
        if method == "PUT" and note_id: return update_note(note_id, event)
        if method == "GET" and note_id: return get_note_response(note_id)
        if method == "DELETE" and note_id: return delete_note(note_id)
        return response(404, {"message": "APIが見つかりません。"})
    except ValueError as error:
        return response(400, {"message": str(error)})
    except Exception as error:
        print(json.dumps({"type": type(error).__name__, "message": str(error)}, ensure_ascii=False))
        return response(500, {"message": "処理中にエラーが発生しました。"})
