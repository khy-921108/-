import { redirect } from 'next/navigation';

// 수료 이력 조회는 출입증 화면으로 통합됨 — 기존 주소로 들어오면 자동 이동.
export default function LookupRedirect() {
  redirect('/access-pass');
}
