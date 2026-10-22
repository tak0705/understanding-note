import json
import os
import uuid
from datetime import datetime, timezone
from decimal import Decimal

import boto3


TABLE_NAME = os.environ["TABLE_NAME"]
MODEL_ID = os.environ["BEDROCK_MODEL_ID"]

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)
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
        "body": json.dumps(
            body,
            ensure_ascii=False,
            cls=DecimalEncoder,
        ),
    }


def parse_body(event):
    raw_body = event.get("body")

    if not raw_body:
        return {}

    try:
        return json.loads(raw_body)
    except json.JSONDecodeError:
        raise ValueError("JSONの形式が正しくありません。")


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def require_text(value, field_name, max_length):
    if not isinstance(value, str):
        raise ValueError(f"{field_name}を入力してください。")

    cleaned = value.strip()

    if not cleaned:
        raise ValueError(f"{field_name}を入力してください。")

    if len(cleaned) > max_length:
        raise ValueError(
            f"{field_name}は{max_length}文字以内で入力してください。"
        )

    return cleaned


def get_note(note_id):
    result = table.get_item(
        Key={
            "note_id": note_id,
        }
    )

    return result.get("Item")


def invoke_bedrock(system_prompt, user_prompt, max_tokens=400):
    result = bedrock.converse(
        modelId=MODEL_ID,
        system=[
            {
                "text": system_prompt,
            }
        ],
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "text": user_prompt,
                    }
                ],
            }
        ],
        inferenceConfig={
            "maxTokens": max_tokens,
            "temperature": 0.2,
        },
    )

    texts = [
        content["text"]
        for content in result["output"]["message"]["content"]
        if "text" in content
    ]

    return "\n".join(texts).strip()


def list_notes():
    result = table.scan()
    items = result.get("Items", [])

    items.sort(
        key=lambda item: item.get("created_at", ""),
        reverse=True,
    )

    return response(200, {"notes": items})


def create_note(event):
    body = parse_body(event)

    title = require_text(
        body.get("title"),
        "タイトル",
        100,
    )

    explanation = require_text(
        body.get("explanation"),
        "自分の説明",
        3000,
    )

    tag = str(body.get("tag", "")).strip()[:30]
    timestamp = now_iso()

    item = {
        "note_id": str(uuid.uuid4()),
        "title": title,
        "explanation": explanation,
        "tag": tag,
        "question": "",
        "answer": "",
        "feedback": "",
        "created_at": timestamp,
        "updated_at": timestamp,
    }

    table.put_item(Item=item)

    return response(201, {"note": item})


def get_note_response(note_id):
    note = get_note(note_id)

    if not note:
        return response(
            404,
            {"message": "メモが見つかりません。"},
        )

    return response(200, {"note": note})


def delete_note(note_id):
    note = get_note(note_id)

    if not note:
        return response(
            404,
            {"message": "メモが見つかりません。"},
        )

    table.delete_item(
        Key={
            "note_id": note_id,
        }
    )

    return response(
        200,
        {"message": "メモを削除しました。"},
    )


def generate_question(note_id):
    note = get_note(note_id)

    if not note:
        return response(
            404,
            {"message": "メモが見つかりません。"},
        )

    system_prompt = """
あなたは学習者の理解を確認する質問者です。
学習者自身の説明を読み、本当に理解しているかを確認する
日本語の質問を1問だけ作成してください。

条件:
- 質問だけを出力する
- 短く分かりやすくする
- メモの文章をそのまま復唱させる質問にしない
- 理由、因果関係、内部動作のいずれかを確認する
""".strip()

    user_prompt = f"""
タイトル:
{note["title"]}

学習者自身の説明:
{note["explanation"]}
""".strip()

    question = invoke_bedrock(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=200,
    )

    table.update_item(
        Key={
            "note_id": note_id,
        },
        UpdateExpression=(
            "SET question = :question, "
            "answer = :empty, "
            "feedback = :empty, "
            "updated_at = :updated_at"
        ),
        ExpressionAttributeValues={
            ":question": question,
            ":empty": "",
            ":updated_at": now_iso(),
        },
    )

    return response(
        200,
        {"question": question},
    )


def evaluate_answer(note_id, event):
    note = get_note(note_id)

    if not note:
        return response(
            404,
            {"message": "メモが見つかりません。"},
        )

    if not note.get("question"):
        return response(
            400,
            {"message": "先に確認質問を作成してください。"},
        )

    body = parse_body(event)

    answer = require_text(
        body.get("answer"),
        "回答",
        3000,
    )

    system_prompt = """
あなたは学習者の理解を確認するレビュアーです。
回答を日本語で簡潔かつ穏やかに評価してください。

次の形式で出力してください。

判定: 理解できています / 概ね理解できています / もう少し確認が必要です
理由: 1〜2文
補足: 必要な場合のみ1〜2文

長い模範解答は不要です。
不足がある場合は、不足している点を具体的に伝えてください。
""".strip()

    user_prompt = f"""
タイトル:
{note["title"]}

元の説明:
{note["explanation"]}

確認質問:
{note["question"]}

学習者の回答:
{answer}
""".strip()

    feedback = invoke_bedrock(
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        max_tokens=400,
    )

    table.update_item(
        Key={
            "note_id": note_id,
        },
        UpdateExpression=(
            "SET answer = :answer, "
            "feedback = :feedback, "
            "updated_at = :updated_at"
        ),
        ExpressionAttributeValues={
            ":answer": answer,
            ":feedback": feedback,
            ":updated_at": now_iso(),
        },
    )

    return response(
        200,
        {
            "answer": answer,
            "feedback": feedback,
        },
    )


def lambda_handler(event, context):
    try:
        http = (
            event
            .get("requestContext", {})
            .get("http", {})
        )

        method = http.get("method", "")
        path = event.get("rawPath", "")

        path_parameters = event.get("pathParameters") or {}
        note_id = path_parameters.get("id")

        if method == "GET" and path == "/notes":
            return list_notes()

        if method == "POST" and path == "/notes":
            return create_note(event)

        if method == "GET" and note_id:
            return get_note_response(note_id)

        if method == "DELETE" and note_id:
            return delete_note(note_id)

        if (
            method == "POST"
            and note_id
            and path.endswith("/question")
        ):
            return generate_question(note_id)

        if (
            method == "POST"
            and note_id
            and path.endswith("/answer")
        ):
            return evaluate_answer(note_id, event)

        return response(
            404,
            {"message": "APIが見つかりません。"},
        )

    except ValueError as error:
        return response(
            400,
            {"message": str(error)},
        )

    except Exception as error:
        print(
            json.dumps(
                {
                    "type": type(error).__name__,
                    "message": str(error),
                    "request_id": getattr(
                        context,
                        "aws_request_id",
                        None,
                    ),
                },
                ensure_ascii=False,
            )
        )

        return response(
            500,
            {
                "message": (
                    "処理中にエラーが発生しました。"
                    "しばらくしてからもう一度お試しください。"
                )
            },
        )
