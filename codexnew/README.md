# 안전보건교육 수료 관리 시스템

제조공장 외부 출입자(화물차 기사 / 일반 작업자 / 중장비 기사)가 공장 입구 QR 코드를 스캔하여 안전보건교육을 이수하고, 6개월 유효한 수료 이력을 관리하는 모바일 웹앱입니다.

---

## 주요 기능

### 사용자 (외부 출입자)
- 공장 입구 QR 코드 스캔 → 웹앱 접속
- 개인정보 동의 → 기본정보 입력
- **중복 교육 방지**: 입력 단계에서 기존 유효 수료 자동 조회
- 대상별 교육 영상 시청 (유튜브 한정공개 임베드, 95% 시청 완료 감지)
- 시험 10문항 응시 (7문항 이상 정답 시 합격)
- 수료증 발급 (수료번호 + QR 코드, 6개월 유효)
- 불합격 시 오답 확인 후 무제한 재응시
- 재접속 조회 (폰+생년월일+성명 3단 검증)

### 관리자
- Supabase Auth 로그인
- 대시보드 통계 (전체/유효/진행중/불합격/만료예정/만료)
- 수료 현황 조회 (상태/기간/이름/대상 필터)
- 시험문제 CRUD
- 교육 과정/영상 CRUD

---

## 기술 스택

| 항목 | 선택 |
|------|------|
| 프레임워크 | Next.js 14 (App Router) + TypeScript |
| DB / 인증 | Supabase (PostgreSQL + Auth) |
| 배포 | Vercel |
| 영상 | YouTube 한정공개(Unlisted) |
| 스타일 | Tailwind CSS |
| QR | qrcode.react |

---

## 비개발자 배포 가이드 (4단계)

### 1단계: GitHub 저장소 생성

1. https://github.com 접속 → 가입 (무료)
2. 우측 상단 **+** → **New repository** 클릭
3. 저장소 이름 입력 (예: `safety-edu`) → **Private** 선택 → **Create repository**
4. 로컬 `codexnew` 폴더의 파일을 저장소에 업로드
   - GitHub Desktop 앱 사용 (권장): https://desktop.github.com/
   - 또는 웹에서 **Add file → Upload files**로 드래그 앤 드롭

### 2단계: Supabase 프로젝트 생성 + DB 스키마 실행

1. https://supabase.com 접속 → 가입 (무료)
2. **New project** → 프로젝트 이름, DB 비밀번호 설정 → **Create new project**
3. 좌측 메뉴 **SQL Editor** → **New query**
4. 파일 `supabase/migrations/001_schema.sql` 내용 전체 복사 → 붙여넣기 → **Run**
   - 9개 테이블과 샘플 데이터(교육 과정 3개, 문제 30개)가 생성됩니다
5. 좌측 메뉴 **Settings → API**에서 아래 3개 값 복사
   - **Project URL** (NEXT_PUBLIC_SUPABASE_URL)
   - **anon public** (NEXT_PUBLIC_SUPABASE_ANON_KEY)
   - **service_role** (SUPABASE_SERVICE_ROLE_KEY) — ⚠️ 외부 노출 금지

### 3단계: 관리자 계정 생성

1. Supabase 대시보드 **Authentication → Users → Add user**
2. 이메일 / 비밀번호 입력 → **Create user**
3. 이 계정으로 배포 후 `/admin/login`에서 로그인 가능

### 4단계: Vercel 배포

1. https://vercel.com 접속 → **Continue with GitHub**으로 가입
2. **Add New → Project** → 1단계에서 만든 GitHub 저장소 선택 → **Import**
3. **Environment Variables** 섹션에 아래 3개 추가
   ```
   NEXT_PUBLIC_SUPABASE_URL = (2단계의 Project URL)
   NEXT_PUBLIC_SUPABASE_ANON_KEY = (2단계의 anon public)
   SUPABASE_SERVICE_ROLE_KEY = (2단계의 service_role)
   ```
4. **Deploy** 클릭 → 2~3분 후 배포 완료
5. 발급된 URL(예: `https://safety-edu.vercel.app`) 확인

### 5단계: QR 코드 생성 + 공장 입구 게시

1. https://www.qr-code-generator.com/ 접속
2. 4단계에서 발급된 Vercel URL 입력 → QR 코드 다운로드
3. A4 용지에 인쇄 → 공장 입구에 게시
4. 완료 🎉

---

## 유튜브 영상 준비

1. YouTube Studio에서 영상 업로드
2. **공개 설정**을 반드시 **"일부 공개(Unlisted)"** 로 선택
   - ❌ "비공개(Private)": 임베드 불가
   - ✅ "일부 공개(Unlisted)": 링크 아는 사람만 시청 가능, 임베드 가능
3. 영상 URL에서 **영상 ID** 복사 (`https://youtu.be/XXXXXXXXXXX` 에서 `XXXXXXXXXXX` 부분)
4. 관리자 페이지 **교육 과정 관리**에서 영상 ID와 길이(초) 등록

---

## 운영 설정 (Supabase SQL Editor에서 변경 가능)

`app_settings` 테이블에서 언제든 값을 수정하면 즉시 반영됩니다.

| 키 | 기본값 | 설명 |
|----|------|------|
| PASS_THRESHOLD | 7 | 10문항 중 합격 최소 정답 수 |
| VALID_MONTHS | 6 | 수료 유효 기간(개월) |
| VIDEO_COMPLETE_RATE | 95 | 영상 완료 판정 최소 시청률(%) |
| COMPLETION_PREFIX | SF | 수료번호 접두사 (예: SF-20260415-0001) |
| QUIZ_COUNT | 10 | 시험 출제 문항 수 |

예시 SQL:
```sql
UPDATE app_settings SET value = '8' WHERE key = 'PASS_THRESHOLD';
```

---

## 관리자 계정 추가

Supabase 대시보드 **Authentication → Users → Add user** 에서 이메일/비밀번호로 생성하면 됩니다. 이 시스템은 Supabase Auth에 등록된 모든 계정을 관리자로 간주합니다.

---

## 운영 주의사항

1. **샘플 데이터 교체 필수**
   - 초기 마이그레이션에 포함된 샘플 영상 ID (`dQw4w9WgXcQ`)와 샘플 문제는 반드시 실제 콘텐츠로 교체하세요.
   - 관리자 페이지에서 교체 가능합니다.

2. **개인정보처리방침**
   - `/consent` 페이지의 내용은 회사 개인정보처리방침에 맞춰 수정하세요.
   - 파일: `src/app/consent/page.tsx`

3. **유튜브 시청률 감지의 한계**
   - MVP 수준으로, 개발자 도구로 조작 가능성이 존재합니다.
   - 증빙 수준이 중요해지면 자체 호스팅 영상(HLS 세그먼트 서명)으로 전환을 검토하세요.

4. **백업**
   - Supabase 무료 티어는 7일 PITR만 지원합니다.
   - 월 1회 **Database → Backups**에서 수동 덤프 다운로드 권장.

5. **만료 예정자 안내**
   - 대시보드에서 30일 이내 만료 예정자 수를 확인하고 재교육을 안내하세요.

---

## 개발자용 로컬 실행

```bash
npm install
cp .env.example .env.local   # 환경변수 3개 입력
npm run dev                  # http://localhost:3000
```

`.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## 시스템 아키텍처

### 데이터베이스 (9개 테이블)

- `target_types` — 교육 대상 (TRUCK/WORKER/HEAVY)
- `courses` — 교육 과정 (버전 관리)
- `course_videos` — 과정별 영상 (과정 1개에 영상 N개)
- `questions` — 시험 문항 풀
- `training_sessions` — 교육 세션 (1 응시 = 1 세션)
- `watch_logs` — 영상별 시청 로그
- `exam_results` — 시험 응시 결과
- `completions` — 수료 이력 (버전 스냅샷 + UNIQUE 제약)
- `app_settings` — 운영 설정값

### 핵심 설계

- **중복 수료 방지**: `completions.session_id UNIQUE` + lookup 선호출
- **버전 스냅샷**: 영상/문제 개정 후에도 수료 당시 기준 증빙
- **영상 스킵 방지**: 1초 단위 Set 추적으로 전체 시청 95% 이상 확인
- **상태 단순화**: `IN_PROGRESS / FAILED / COMPLETED / EXPIRED`

---

## 플로우 다이어그램

```
QR 스캔
  ↓
시작 화면
  ↓ 첫 방문
개인정보 동의 → 기본정보 입력
              ↓ (폰+생년월일+성명)
           /api/lookup 자동 호출
              ├─ 유효 수료 있음 → 수료증 화면
              └─ 없음 → 세션 생성
                        ↓
                     영상 시청 (전 영상 95%)
                        ↓
                     시험 10문항
                        ├─ 합격(≥7) → 수료증 발급
                        └─ 불합격 → 오답 확인 → 재응시
```

```
QR 스캔
  ↓
시작 화면
  ↓ 재접속 조회
폰+생년월일+성명
  ↓
/api/lookup
  ├─ 유효 수료 → 수료증 + 만료일
  ├─ 만료 → 재교육 안내
  └─ 없음 → 교육 시작 안내
```

---

## 라이선스

사내 사용 목적으로 제작됨. 외부 배포 시 별도 라이선스 검토 필요.
