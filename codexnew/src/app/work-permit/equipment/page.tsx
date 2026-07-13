'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { readDraft, writeDraft, type WpParticipant, type WpEquipment } from '@/lib/work-permit-draft';

const normPlate = (s?: string | null) => (s ?? '').replace(/[\s-]/g, '').toUpperCase();

export default function WorkPermitEquipment() {
  const router = useRouter();
  const [participants, setParticipants] = useState<WpParticipant[]>([]);
  const [heavyChecked, setHeavyChecked] = useState(false);
  const [rows, setRows] = useState<{ type: string; vehicleNumber: string }[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const d = readDraft();
    if (!d.company || !d.applicant || !d.info || !(d.participants && d.participants.length > 0)) {
      router.replace('/work-permit');
      return;
    }
    const supp = d.supplemental ?? {};
    // 중장비·굴착 둘 다 아니면 이 단계 불필요 → 서류로
    if (supp.heavy !== 'Y' && supp.excavation !== 'Y') {
      router.replace('/work-permit/docs');
      return;
    }
    setHeavyChecked(supp.heavy === 'Y');
    setParticipants(d.participants);
    setRows(d.equipment && d.equipment.length > 0
      ? d.equipment.map((e) => ({ type: e.type, vehicleNumber: e.vehicleNumber }))
      : [{ type: '', vehicleNumber: '' }]);
  }, [router]);

  const heavyParts = participants.filter((p) => (p.target ?? '') === 'HEAVY');
  const heavyPlates = heavyParts.map((p) => normPlate(p.vehicleNumber)).filter(Boolean);
  const isMatched = (v: string) => !!normPlate(v) && heavyPlates.includes(normPlate(v));

  const addRow = () => setRows((r) => [...r, { type: '', vehicleNumber: '' }]);
  const removeRow = (i: number) => setRows((r) => r.filter((_, idx) => idx !== i));
  const setRow = (i: number, k: 'type' | 'vehicleNumber', v: string) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, [k]: v } : row)));

  const goNext = () => {
    setError('');
    // ⛔ 중장비 체크인데 HEAVY 수료 참여자 0명 → 차단(굴착만이면 통과)
    if (heavyChecked && heavyParts.length === 0) {
      setError('중장비 작업에는 중장비 교육을 수료한 기사가 1명 이상 필요합니다. 참여자 단계에서 추가해 주세요.');
      return;
    }
    const equipment: WpEquipment[] = rows
      .map((r) => ({ type: r.type.trim(), vehicleNumber: r.vehicleNumber.trim() }))
      .filter((r) => r.type || r.vehicleNumber)
      .map((r) => ({ type: r.type, vehicleNumber: r.vehicleNumber, matched: isMatched(r.vehicleNumber) }));
    writeDraft({ equipment });
    router.push('/work-permit/docs');
  };

  return (
    <main className="space-y-6">
      <header>
        <p className="text-sm font-semibold text-brand">🚜 장비 정보 확인</p>
        <h1 className="mt-1 text-2xl font-bold text-slate-800">중장비 · 굴착 장비</h1>
        <p className="mt-1 text-sm text-slate-500">이번 작업에 들어오는 장비의 종류·차량번호를 입력하세요. 중장비 교육 수료 기사의 등록 차량과 자동 대조합니다.</p>
      </header>

      {/* 중장비 교육 수료 기사(등록 장비) */}
      <section className="card space-y-2">
        <h2 className="text-sm font-bold text-slate-700">중장비 교육 수료 기사 ({heavyParts.length})</h2>
        {heavyParts.length === 0 ? (
          <p className={`text-sm ${heavyChecked ? 'text-red-600 font-bold' : 'text-slate-400'}`}>
            {heavyChecked
              ? '⛔ 중장비 교육을 수료한 기사가 없습니다. 참여자 단계에서 추가해야 진행할 수 있습니다.'
              : '중장비 교육 수료 참여자가 없습니다 (굴착만 체크: 장비 입력은 선택).'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {heavyParts.map((p, i) => (
              <li key={i} className="py-1.5 text-sm">
                <span className="font-medium text-slate-800">{p.name}</span>
                <span className="text-xs text-slate-500"> · {p.equipmentType || '중장비'}{p.vehicleNumber ? ` · 🚗 ${p.vehicleNumber}` : ' · 등록 차량번호 없음'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 장비 입력 */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-slate-700">이번 작업 장비</h2>
        {rows.map((r, i) => {
          const matched = isMatched(r.vehicleNumber);
          return (
            <div key={i} className="card space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="label">종류</label>
                  <input className="input-base" value={r.type} onChange={(e) => setRow(i, 'type', e.target.value)} placeholder="예: 굴착기·지게차·크레인" />
                </div>
                <div className="flex-1">
                  <label className="label">차량/장비 번호</label>
                  <input className="input-base" value={r.vehicleNumber} onChange={(e) => setRow(i, 'vehicleNumber', e.target.value)} placeholder="예: 12가3456" />
                </div>
              </div>
              <div className="flex items-center justify-between">
                {r.vehicleNumber.trim() ? (
                  matched
                    ? <span className="text-xs font-bold text-emerald-700">✅ 교육 등록 차량과 일치</span>
                    : <span className="text-xs font-bold text-amber-700">⚠ 교육 등록 차량과 불일치 (신청은 가능 · 현장 확인)</span>
                ) : <span className="text-xs text-slate-400">차량번호 입력 시 자동 대조</span>}
                {rows.length > 1 && <button type="button" onClick={() => removeRow(i)} className="text-xs text-red-600 hover:underline">삭제</button>}
              </div>
            </div>
          );
        })}
        <button type="button" onClick={addRow} className="w-full rounded-xl border-2 border-dashed border-brand bg-white px-4 py-3 text-sm font-bold text-brand hover:bg-brand/5">
          + 장비 추가
        </button>
      </section>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="flex gap-2">
        <button type="button" onClick={() => router.push('/work-permit/participants')} className="btn-secondary">이전</button>
        <button type="button" onClick={goNext} className="btn-primary">다음</button>
      </div>
    </main>
  );
}
