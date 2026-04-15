import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/supabase/auth';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * GET /api/admin/questions?targetType=
 * POST /api/admin/questions
 * PUT /api/admin/questions
 * DELETE /api/admin/questions?id=
 */

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const targetType = url.searchParams.get('targetType');
  const supabase = createServiceClient();

  let q = supabase
    .from('questions')
    .select('*, target_types(code, label)')
    .order('id', { ascending: true });

  if (targetType) {
    const { data: tt } = await supabase.from('target_types').select('id').eq('code', targetType).single();
    if (tt) q = q.eq('target_type_id', tt.id);
  }

  const { data, error } = await q;
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data: { items: data } });
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const supabase = createServiceClient();

  const { data: tt } = await supabase.from('target_types').select('id').eq('code', body.targetType).single();
  if (!tt) return NextResponse.json({ success: false, message: '대상 구분 오류' }, { status: 400 });

  const { data, error } = await supabase
    .from('questions')
    .insert({
      target_type_id: tt.id,
      question_text: body.questionText,
      option_1: body.option1,
      option_2: body.option2,
      option_3: body.option3,
      option_4: body.option4,
      correct_option: body.correctOption,
      explanation: body.explanation ?? null,
      is_active: body.isActive ?? true,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true, data });
}

export async function PUT(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const body = await req.json();
  const supabase = createServiceClient();

  const update: Record<string, any> = {};
  if (body.questionText !== undefined) update.question_text = body.questionText;
  if (body.option1 !== undefined) update.option_1 = body.option1;
  if (body.option2 !== undefined) update.option_2 = body.option2;
  if (body.option3 !== undefined) update.option_3 = body.option3;
  if (body.option4 !== undefined) update.option_4 = body.option4;
  if (body.correctOption !== undefined) update.correct_option = body.correctOption;
  if (body.explanation !== undefined) update.explanation = body.explanation;
  if (body.isActive !== undefined) update.is_active = body.isActive;

  const { error } = await supabase.from('questions').update(update).eq('id', body.id);
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

export async function DELETE(req: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const id = url.searchParams.get('id');
  if (!id) return NextResponse.json({ success: false, message: 'id 필요' }, { status: 400 });

  const supabase = createServiceClient();
  const { error } = await supabase.from('questions').delete().eq('id', id);
  if (error) return NextResponse.json({ success: false, message: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
