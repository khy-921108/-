# claude-gpt-mcp

Claude Code 안에서 GPT를 검산·리뷰·토론 상대로 부르되, 별도 API 요금 없이 **ChatGPT 구독**(Codex CLI 로그인)으로 쓰는 구성.

현재 상태: **설계 단계 (B-2)**. 코드 없음.

- 설계 문서: [`docs/DESIGN.md`](docs/DESIGN.md)
- 교차검토 체크리스트: [`docs/CROSS_CHECK.md`](docs/CROSS_CHECK.md)
- Claude 스킬 초안: [`skill/gpt-check/SKILL.md`](skill/gpt-check/SKILL.md)

구성: Codex CLI(OpenAI 배포, 설치만) + codex-bridge 래퍼(`codex exec` 자식 프로세스) + 스킬 gpt-check.
경로 A(`claude mcp add codex -- codex mcp-server`)는 코드 없이 바로 쓸 수 있으나 폐기 예정이라, 래퍼(경로 B)를 함께 설계함.
