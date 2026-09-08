# claude-gpt-mcp

Claude Code 안에서 GPT를 검산·리뷰·토론 상대로 부르되, 별도 API 요금 없이 **ChatGPT 구독**(Codex CLI 로그인)으로 쓰는 구성.

현재 상태: **구현 완료, pytest 74건 통과.** 실제 ChatGPT 계정으로의 왕복만 사용자 PC에서 1회 확인 필요(아래 참고).

- 코드: [`codex-bridge/`](codex-bridge/) — 설치·실행은 [`codex-bridge/README.md`](codex-bridge/README.md)
- 설계 문서: [`docs/DESIGN.md`](docs/DESIGN.md)
- 교차검토 체크리스트: [`docs/CROSS_CHECK.md`](docs/CROSS_CHECK.md)
- Claude 스킬: [`skill/gpt-check/SKILL.md`](skill/gpt-check/SKILL.md) (codex-bridge가 이 파일을 그대로 파싱해서 씀)

구성: Codex CLI(OpenAI 배포, 설치만) + codex-bridge 래퍼(`codex exec` 자식 프로세스) + 스킬 gpt-check.
경로 A(`claude mcp add codex -- codex mcp-server`)는 코드 없이 바로 쓸 수 있으나 폐기 예정이라, 래퍼(경로 B)로 구현함.

## 남은 유일한 단계

이 개발 환경엔 ChatGPT 로그인·네트워크 egress가 없어 **진짜 GPT 응답이 오가는 왕복만은 검증하지 못했다.**
코드·테스트는 전부 가짜 `codex` CLI로 검증됐다(DESIGN.md §0.1, §10). 사용자 PC에서:

```bash
npm install -g @openai/codex && codex login
cd claude-gpt-mcp/codex-bridge && pip install -r requirements.txt
cp config.example.json config.json   # allowed_roots 채우기
```

를 한 뒤 Claude Code에 등록하고 `gpt_status` → `gpt_ask`로 확인하면 끝난다.
