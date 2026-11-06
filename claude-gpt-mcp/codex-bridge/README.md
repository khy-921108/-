# codex-bridge

Claude Code용 MCP 서버. Codex CLI(`codex exec`)를 자식 프로세스로 실행해 GPT를 검산·리뷰·토론
상대로 부른다. API 키가 아니라 **ChatGPT 구독 로그인**을 쓴다. 설계 배경은 `../docs/DESIGN.md` 참고.

## 요구 사항

- Python 3.11+
- Node/npm (Codex CLI 설치용)
- ChatGPT 계정 (Plus/Pro/Business/Enterprise — Codex 사용량이 포함된 플랜)

## 설치

```bash
npm install -g @openai/codex
codex login              # 브라우저에서 ChatGPT 로그인
codex login status       # "Logged in as ..." 확인

cd codex-bridge
pip install -r requirements.txt

cp config.example.json config.json
# config.json의 limits.allowed_roots에 GPT가 읽어도 되는 폴더를 추가한다.
# 비워두면 cwd를 쓰는 모든 호출이 거부된다(안전 기본값).
```

## 동작 확인

```bash
python -m pytest        # 코드 자체 검증 (가짜 codex CLI로 74건, 실제 로그인 불필요)
python server.py        # 실제 Claude Code 없이 손으로 stdio 왕복을 보고 싶다면
                         # 별도 MCP 클라이언트나 tests/test_server.py 참고
```

`python -m pytest`는 진짜 ChatGPT 응답을 검증하지 않는다(가짜 `codex` 실행 파일을 씀). 로그인 후
실제 왕복이 되는지는 아래 Claude Code 등록 후 `gpt_status`, `gpt_ask`로 직접 확인해야 한다
(DESIGN.md §0.1에 남은 유일한 미확인 항목).

## Claude Code 등록

`.mcp.json` (프로젝트) 또는 사용자 설정에 추가:

```json
{
  "mcpServers": {
    "codex-bridge": {
      "command": "python",
      "args": ["server.py"],
      "cwd": "/absolute/path/to/codex-bridge",
      "timeout": 900000
    }
  }
}
```

`timeout`은 밀리초 단위 MCP 도구 타임아웃(Codex 응답이 수 분 걸릴 수 있어 넉넉히 잡음)이다.
`config.json`을 다른 경로에 두려면 `CODEX_BRIDGE_CONFIG` 환경변수로 지정한다.

Claude Code에서 도구가 보이면:

1. `gpt_status`로 codex 버전·로그인 상태·설정을 먼저 확인
2. `gpt_ask`로 짧은 질문을 던져 왕복이 되는지 확인
3. 이후 `gpt_cross_check` / `gpt_review` / `gpt_debate`, 스킬 `gpt-check` 규칙에 따라 사용

경로 A(래퍼 없이 바로 쓰는 방법, 코드 0줄이지만 폐기 예정 경고 있음)도 여전히 유효하다:

```bash
claude mcp add codex --scope user -- codex mcp-server
```

## 폴더 구조

```
codex-bridge/
├─ server.py            진입점 (도구 등록만)
├─ config.example.json  설정 예시 — 복사해서 config.json 만들 것 (git에 커밋 안 함)
├─ core/                codex_runner · session_map · validator · prompts · logger · config · errors
├─ tools/               ask · review · cross_check · debate · manage(status·session)
├─ schemas/             --output-schema로 Codex에 넘기는 JSON Schema 3종
└─ tests/               pytest 74건 (가짜 codex CLI + 실제 mcp SDK stdio 왕복)
```

## 알려진 한계

- 정확한 잔여 사용 한도는 계산하지 않는다. Codex의 `/usage`로 직접 확인할 것.
- `codex exec` JSONL 이벤트 중 최종 답변이 실제로 어떤 `type`으로 오는지는 미확인이라(§0.1),
  최종 메시지는 우선 `-o` 옵션이 만드는 파일에서 읽는다. 이 파일이 비어 있을 때만 이벤트 스트림을
  뒤져 최선 추정으로 보완한다.
- Windows에서의 실제 실행(코드 심 `codex.cmd`, `taskkill /T`)은 코드에는 반영했지만 이 개발 환경이
  Linux라 실기 확인은 못 했다.
