-- ==========================================================
-- R-6: TBM 현장 사진 저장용 비공개 Storage 버킷.
--  · base64를 DB(tbm JSONB)에 넣지 않고 Storage 경로만 저장.
--  · 비공개(public=false) — 서비스 롤(서버)만 업로드/다운로드. 출력 시 서버가 임베드.
--  · 업로드 전 클라이언트에서 ~200KB로 리사이즈.
-- ⚠️ 이 SQL을 Supabase에서 먼저 실행할 것.
-- ==========================================================

insert into storage.buckets (id, name, public)
values ('work-permit-photos', 'work-permit-photos', false)
on conflict (id) do nothing;

-- RLS: storage.objects 는 기본 RLS가 켜져 있고, 서버는 service_role 로 접근(정책 우회).
-- 익명(anon) 접근은 허용하지 않으므로 별도 anon 정책을 만들지 않는다.
