'use client';

import { useEffect, useState } from 'react';
import {
  COMPANY_STATUS,
  COMPANY_TYPES,
  companyStatusLabel,
  companyTypeLabel,
  type CompanyStatus,
  type CompanyType,
} from '@/lib/company';

interface CompanyItem {
  id: string;
  name: string;
  biz_no: string | null;
  company_type: CompanyType;
  manager_name: string | null;
  phone: string | null;
  status: CompanyStatus;
  created_by: 'APPLICANT' | 'ADMIN';
  note: string | null;
  created_at: string;
  updated_at: string;
}

interface Stats {
  total: number;
  review: number;
  active: number;
  disabled: number;
}

function statusBadge(status: CompanyStatus) {
  const map: Record<CompanyStatus, string> = {
    REVIEW: 'bg-amber-100 text-amber-700',
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    DISABLED: 'bg-slate-200 text-slate-600',
  };
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-bold ${map[status]}`}>
      {companyStatusLabel(status)}
    </span>
  );
}

export default function AdminCompaniesPage() {
  const [items, setItems] = useState<CompanyItem[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, review: 0, active: 0, disabled: 0 });
  const [loading, setLoading] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [filterType, setFilterType] = useState<'' | CompanyType>('');
  const [filterStatus, setFilterStatus] = useState<'' | CompanyStatus>('');
  const [editing, setEditing] = useState<CompanyItem | null>(null);
  const [creating, setCreating] = useState(false);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (keyword) params.set('keyword', keyword);
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    try {
      const res = await fetch(`/api/admin/companies?${params.toString()}`);
      const json = await res.json();
      if (json.success) {
        setItems(json.data.items);
        setStats(json.data.stats);
      } else {
        alert(json.message || '조회 실패');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setEditing(null);
        setCreating(false);
      }
    };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, []);

  return (
    <main className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-800">업체 관리</h1>
        <button onClick={() => setCreating(true)} className="text-sm font-bold text-brand hover:underline">
          + 신규 업체 추가
        </button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <StatCard label="전체" value={stats.total} />
        <StatCard label="검토중" value={stats.review} color="text-amber-700" />
        <StatCard label="정식등록" value={stats.active} color="text-emerald-700" />
        <StatCard label="사용중지" value={stats.disabled} color="text-slate-500" />
      </div>

      <div className="card space-y-3">
        <input
          className="input-base"
          placeholder="업체명 또는 담당자 검색"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <select
            className="input-base"
            value={filterType}
            onChange={(e) => setFilterType(e.target.value as '' | CompanyType)}
          >
            <option value="">구분: 전체</option>
            {COMPANY_TYPES.map((t) => (
              <option key={t.code} value={t.code}>
                {t.label}
              </option>
            ))}
          </select>
          <select
            className="input-base"
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value as '' | CompanyStatus)}
          >
            <option value="">상태: 전체</option>
            {COMPANY_STATUS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
        <button onClick={load} className="btn-primary">
          {loading ? '조회 중...' : '조회'}
        </button>
      </div>

      <div className="space-y-2">
        <p className="text-xs text-slate-500">총 {items.length}건 · 카드 클릭 시 수정</p>
        {items.map((it) => (
          <button
            type="button"
            key={it.id}
            onClick={() => setEditing(it)}
            className="card w-full text-left hover:shadow-md transition space-y-2"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-slate-800">{it.name}</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {companyTypeLabel(it.company_type)}
                  {it.biz_no ? ` · 사업자 ${it.biz_no}` : ''}
                </p>
                {(it.manager_name || it.phone) && (
                  <p className="text-xs text-slate-600 mt-0.5">
                    {it.manager_name || '담당자 미입력'} · {it.phone || '연락처 없음'}
                  </p>
                )}
              </div>
              {statusBadge(it.status)}
            </div>
            {it.note && (
              <p className="text-xs text-slate-500 truncate">메모: {it.note}</p>
            )}
            <p className="text-[11px] text-slate-400">
              등록주체: {it.created_by === 'APPLICANT' ? '신청자' : '관리자'}
            </p>
          </button>
        ))}
        {items.length === 0 && !loading && (
          <div className="card text-center text-slate-500 py-8">조회 결과가 없습니다.</div>
        )}
      </div>

      {(editing || creating) && (
        <CompanyEditModal
          item={editing}
          mode={creating ? 'create' : 'edit'}
          onClose={() => {
            setEditing(null);
            setCreating(false);
          }}
          onSaved={async () => {
            setEditing(null);
            setCreating(false);
            await load();
          }}
        />
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="rounded-xl bg-white border border-slate-100 p-3 text-center shadow-sm">
      <p className="text-[11px] text-slate-500">{label}</p>
      <p className={`text-lg font-extrabold ${color ?? 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

function CompanyEditModal({
  item,
  mode,
  onClose,
  onSaved,
}: {
  item: CompanyItem | null;
  mode: 'create' | 'edit';
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(item?.name ?? '');
  const [bizNo, setBizNo] = useState(item?.biz_no ?? '');
  const [companyType, setCompanyType] = useState<CompanyType>(item?.company_type ?? 'GENERAL');
  const [managerName, setManagerName] = useState(item?.manager_name ?? '');
  const [phone, setPhone] = useState(item?.phone ?? '');
  const [status, setStatus] = useState<CompanyStatus>(item?.status ?? 'ACTIVE');
  const [note, setNote] = useState(item?.note ?? '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const formatPhone = (v: string) => v.replace(/[^0-9]/g, '').slice(0, 11);

  const onSave = async () => {
    setErr('');
    if (!name.trim()) {
      setErr('업체명을 입력해 주세요.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: name.trim(),
        bizNo,
        companyType,
        managerName,
        phone,
        status,
        note,
      };
      const url = mode === 'create' ? '/api/admin/companies' : `/api/admin/companies/${item!.id}`;
      const method = mode === 'create' ? 'POST' : 'PATCH';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) {
        setErr(json.message || '저장 실패');
        return;
      }
      onSaved();
    } catch (e) {
      console.error(e);
      setErr('네트워크 오류가 발생했습니다.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="modal-overlay fixed inset-0 z-50 bg-black/50 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-8"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 p-4 flex justify-between items-center">
          <h2 className="text-lg font-bold text-slate-800">
            {mode === 'create' ? '신규 업체 추가' : '업체 수정'}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-2xl leading-none"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="label">업체명 *</label>
            <input
              className="input-base"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">사업자번호</label>
            <input
              className="input-base"
              value={bizNo}
              onChange={(e) => setBizNo(e.target.value)}
              placeholder="000-00-00000"
            />
          </div>
          <div>
            <label className="label">업체 구분</label>
            <select
              className="input-base"
              value={companyType}
              onChange={(e) => setCompanyType(e.target.value as CompanyType)}
            >
              {COMPANY_TYPES.map((t) => (
                <option key={t.code} value={t.code}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">담당자명</label>
            <input
              className="input-base"
              value={managerName}
              onChange={(e) => setManagerName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">담당자 연락처</label>
            <input
              type="tel"
              inputMode="numeric"
              className="input-base"
              value={phone}
              onChange={(e) => setPhone(formatPhone(e.target.value))}
              placeholder="01012345678"
            />
          </div>
          <div>
            <label className="label">상태</label>
            <select
              className="input-base"
              value={status}
              onChange={(e) => setStatus(e.target.value as CompanyStatus)}
            >
              {COMPANY_STATUS.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">비고</label>
            <textarea
              className="input-base min-h-[80px]"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          {err && (
            <div className="rounded-lg bg-red-50 p-2 text-xs text-red-700">{err}</div>
          )}
        </div>

        <div className="border-t border-slate-200 p-4 flex gap-2">
          <button onClick={onClose} className="btn-secondary flex-1">
            취소
          </button>
          <button onClick={onSave} disabled={saving} className="btn-primary flex-1">
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
