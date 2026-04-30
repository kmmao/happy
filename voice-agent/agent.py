import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from livekit import agents
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    RunContext,
    TurnHandlingOptions,
    function_tool,
    get_job_context,
    inference,
)
from livekit.rtc import DataPacket
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

ENV_PATH = Path(__file__).with_name(".env.local")
REQUIRED_ENV_VARS = ("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET")

load_dotenv(ENV_PATH)

missing_env_vars = [name for name in REQUIRED_ENV_VARS if not os.environ.get(name)]
if missing_env_vars:
    raise RuntimeError(f"Missing required environment variables: {', '.join(missing_env_vars)}")


AGENT_NAME = "happy-voice"


class HappyVoiceAssistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions="""You are the voice interface for Happy Coder, a tool that controls Claude Code remotely.

Your role:
- Relay user's voice commands to Claude Code via the messageClaudeCode tool
- Handle permission requests from Claude Code (allow/deny) via processPermissionRequest
- Report Claude Code's responses and status updates to the user verbally

Context:
- You receive sessionId and initialConversationContext via LiveKit room metadata
- You receive contextual updates about session events, messages, and permission requests over LiveKit data messages

Rules:
- When the user gives a coding instruction, call messageClaudeCode immediately with the instruction
- When Claude Code asks for permission, clearly explain what it wants to do, then ask the user to allow or deny
- When you receive a ready event, report the summary to the user immediately
- Keep your verbal responses concise — the user wants speed, not lengthy explanations
- If the user says something ambiguous, ask for clarification before calling a tool
- Respond in the same language the user speaks to you""",
            tools=[message_claude_code, process_permission_request],
        )


@function_tool()
async def message_claude_code(context: RunContext, message: str) -> str:
    """Send a message or instruction to Claude Code in the active coding session.

    Args:
        message: The message to send to Claude Code. This should be the user's instruction or question.
    """
    room = get_job_context().room
    participant = next(iter(room.remote_participants.values()), None)
    if participant is None:
        return json.dumps({"status": "error", "error": "no_participant"})

    response = await room.local_participant.perform_rpc(
        destination_identity=participant.identity,
        method="messageClaudeCode",
        payload=json.dumps({"message": message}),
        response_timeout=10.0,
    )
    return response


@function_tool()
async def process_permission_request(context: RunContext, decision: str) -> str:
    """Process a permission request from Claude Code.

    Args:
        decision: The user's decision on the permission request. Must be either 'allow' or 'deny'.
    """
    if decision not in ("allow", "deny"):
        return json.dumps({"status": "error", "error": "invalid_decision"})

    room = get_job_context().room
    participant = next(iter(room.remote_participants.values()), None)
    if participant is None:
        return json.dumps({"status": "error", "error": "no_participant"})

    response = await room.local_participant.perform_rpc(
        destination_identity=participant.identity,
        method="processPermissionRequest",
        payload=json.dumps({"decision": decision}),
        response_timeout=10.0,
    )
    return response


async def handle_data_message(session: AgentSession, data: bytes) -> None:
    try:
        payload = json.loads(data.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return

    message_type = payload.get("type")
    if message_type == "context_update":
        content = payload.get("content")
        if isinstance(content, str) and content:
            chat_ctx = session.current_agent.chat_ctx.copy()
            chat_ctx.add_message(role="system", content=content)
            await session.current_agent.update_chat_ctx(chat_ctx)
        return

    if message_type == "user_message":
        message = payload.get("message")
        if isinstance(message, str) and message:
            await session.generate_reply(user_input=message)


server = AgentServer(num_idle_processes=1)


@server.rtc_session(agent_name=AGENT_NAME)
async def happy_voice_agent(ctx: agents.JobContext) -> None:
    session = AgentSession(
        stt=inference.STT(model="deepgram/nova-3", language="multi"),
        llm=inference.LLM(model="openai/gpt-5.3-chat-latest"),
        tts=inference.TTS(
            model="cartesia/sonic-3",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
            language="en",
        ),
        vad=silero.VAD.load(),
        turn_handling=TurnHandlingOptions(
            turn_detection=MultilingualModel(),
        ),
    )

    @ctx.room.on("data_received")
    def on_data_received(packet: DataPacket) -> None:
        asyncio.create_task(handle_data_message(session, packet.data))

    await session.start(room=ctx.room, agent=HappyVoiceAssistant())

    greeting = (
        "I'm connected to your coding session. What would you like me to tell Claude Code?"
        if ctx.room.metadata
        else "Hey! I'm connected. What would you like me to tell Claude Code?"
    )
    await session.generate_reply(instructions=greeting)


if __name__ == "__main__":
    agents.cli.run_app(server)
