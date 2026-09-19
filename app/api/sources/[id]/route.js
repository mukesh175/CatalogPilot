import prisma from '../../../../lib/prisma.js';
import { withAuth, json, apiError, parseBody } from '../../../../lib/api.js';
import { updateSourceSchema } from '../../../../validators/index.js';
import { getSource, disconnectSource, refreshSource } from '../../../../services/data-source.js';
import { setSchedule, PlanLimitError } from '../../../../services/job-service.js';

export const GET = withAuth(async (request, { shopId, params }) => {
  const source = await getSource(shopId, params.id);
  if (!source) return apiError('That data source could not be found.', { status: 404, code: 'not_found' });

  const selected = source.sheets.find((s) => s.isSelected) || null;
  return json({
    source: {
      id: source.id,
      name: source.name,
      kind: source.kind,
      status: source.status,
      spreadsheetId: source.spreadsheetId,
      fileUrl: source.fileUrl,
      schedule: source.schedule,
      isPaused: source.isPaused,
      nextRunAt: source.nextRunAt,
      lastRunAt: source.lastRunAt,
      lastModifiedAt: source.lastModifiedAt,
      settings: {
        allowBlankOverwrite: source.allowBlankOverwrite,
        allowStatusChange: source.allowStatusChange,
        allowImageUpdate: source.allowImageUpdate,
      },
      connection: source.googleConnection
        ? {
            id: source.googleConnection.id,
            email: source.googleConnection.email,
            isRevoked: source.googleConnection.isRevoked,
          }
        : null,
      worksheets: source.sheets.map((s) => ({
        sheetId: s.sheetId,
        title: s.title,
        rowCount: s.rowCount,
        columnCount: s.columnCount,
        isSelected: s.isSelected,
      })),
      selectedWorksheet: selected
        ? { sheetId: selected.sheetId, title: selected.title, headerRow: selected.headerRow, headers: selected.headers }
        : null,
    },
  });
});

export const PATCH = withAuth(async (request, { shopId, params }) => {
  const body = await parseBody(request, updateSourceSchema);

  const existing = await prisma.dataSource.findFirst({ where: { id: params.id, shopId } });
  if (!existing) return apiError('That data source could not be found.', { status: 404, code: 'not_found' });

  // Schedule changes run through the entitlement check rather than a direct
  // write, because the available schedules depend on the plan.
  if (body.schedule && body.schedule !== existing.schedule) {
    try {
      await setSchedule({ shopId, dataSourceId: params.id, schedule: body.schedule });
    } catch (error) {
      if (error instanceof PlanLimitError) {
        return apiError(error.message, {
          status: 402,
          code: 'plan_limit',
          details: { upgradeTo: error.upgradeTo },
        });
      }
      throw error;
    }
  }

  const { schedule, ...rest } = body;
  const source = await prisma.dataSource.update({ where: { id: params.id }, data: rest });

  return json({
    source: {
      id: source.id,
      name: source.name,
      schedule: source.schedule,
      isPaused: source.isPaused,
      nextRunAt: source.nextRunAt,
      settings: {
        allowBlankOverwrite: source.allowBlankOverwrite,
        allowStatusChange: source.allowStatusChange,
        allowImageUpdate: source.allowImageUpdate,
      },
    },
  });
});

export const DELETE = withAuth(async (request, { shopId, params }) => {
  const removed = await disconnectSource({ shopId, dataSourceId: params.id });
  if (!removed) return apiError('That data source could not be found.', { status: 404, code: 'not_found' });
  return json({ disconnected: true });
});

export const POST = withAuth(async (request, { shopId, params }) => {
  const result = await refreshSource({ shopId, dataSourceId: params.id });
  if (!result) return apiError('Select a worksheet before refreshing.', { status: 409, code: 'no_worksheet' });
  return json(result);
});
