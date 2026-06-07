// @vitest-environment jsdom
// TASK 4 · етап B — DrivePickerSection винесено зі AddDocumentModal у
// components/DrivePicker/. Тест фіксує поведінку винесеного пікера:
// browse, single-pick, multi-images select+confirm, джерела (chips).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const driveRequest = vi.fn();
vi.mock('../../src/services/driveAuth.js', () => ({
  driveRequest: (...args) => driveRequest(...args),
}));

import { DrivePickerSection } from '../../src/components/DrivePicker/index.jsx';

const FILES = [
  { id: 'fold1', name: 'Папка А', mimeType: 'application/vnd.google-apps.folder' },
  { id: 'pdf1', name: 'позов.pdf', mimeType: 'application/pdf', size: '2048' },
  { id: 'img1', name: 'скан.jpg', mimeType: 'image/jpeg', size: '4096' },
];

function ok(json) {
  return { ok: true, status: 200, json: async () => json };
}

beforeEach(() => {
  driveRequest.mockReset();
  driveRequest.mockImplementation(async (url) => {
    if (url.includes('/drives?')) return ok({ drives: [] });   // shared-drives check / list
    if (url.includes('files?q=')) return ok({ files: FILES }); // вміст папки
    return ok({});                                             // breadcrumb walk тощо
  });
});

describe('DrivePickerSection (винос, етап B)', () => {
  it('відкритий: показує джерела + список вмісту папки', async () => {
    render(<DrivePickerSection isOpen initialFolderId="root" onToggle={() => {}} onPick={() => {}} />);
    expect(screen.getByRole('tab', { name: /Мій Drive/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Поділилися зі мною/ })).toBeInTheDocument();
    expect(await screen.findByText('Папка А')).toBeInTheDocument();
    expect(screen.getByText('позов.pdf')).toBeInTheDocument();
    expect(screen.getByText('скан.jpg')).toBeInTheDocument();
  });

  it('single mode: клік по файлу викликає onPick(item)', async () => {
    const onPick = vi.fn();
    render(<DrivePickerSection isOpen initialFolderId="root" onToggle={() => {}} onPick={onPick} />);
    fireEvent.click(await screen.findByText('позов.pdf'));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0][0].id).toBe('pdf1');
  });

  it('multi-images: лише папки+зображення; select+confirm → onPickMulti([images])', async () => {
    const onPickMulti = vi.fn();
    render(
      <DrivePickerSection
        isOpen
        initialFolderId="root"
        onToggle={() => {}}
        onPick={() => {}}
        onPickMulti={onPickMulti}
        selectionMode="multi-images"
      />,
    );
    // PDF відфільтровано у multi-images; зображення і папка лишаються.
    expect(await screen.findByText('скан.jpg')).toBeInTheDocument();
    expect(screen.getByText('Папка А')).toBeInTheDocument();
    expect(screen.queryByText('позов.pdf')).toBeNull();

    fireEvent.click(screen.getByText('скан.jpg'));
    const confirmBtn = await screen.findByRole('button', { name: /Обрати 1 зображення/ });
    fireEvent.click(confirmBtn);
    expect(onPickMulti).toHaveBeenCalledTimes(1);
    expect(onPickMulti.mock.calls[0][0].map((f) => f.id)).toEqual(['img1']);
  });

  it('закритий: список не рендериться', () => {
    render(<DrivePickerSection isOpen={false} initialFolderId="root" onToggle={() => {}} onPick={() => {}} />);
    expect(screen.queryByText('позов.pdf')).toBeNull();
  });
});
