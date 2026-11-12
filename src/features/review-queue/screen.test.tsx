import { act, screen, userEvent, waitFor } from '@testing-library/react-native';
import { useState } from 'react';
import { Alert, Pressable } from 'react-native';
import { notifyDataChanged } from '@/lib/data-changes';
import {
  confirmCandidate,
  listReviewCandidates,
  rejectCandidate,
  type ReviewCandidate,
} from '@/lib/review-queue';
import { renderWithQueries } from '@/test/render-with-queries';
import ReviewQueueScreen from './screen';

jest.mock('@/lib/review-queue', () => ({
  listReviewCandidates: jest.fn(),
  confirmCandidate: jest.fn(),
  rejectCandidate: jest.fn(),
}));

const candidate: ReviewCandidate = {
  id: 7,
  confidenceNote: 'Same amount on the same day',
  date: 20000,
  amountMinor: 1250,
  outgoingAccount: 'Cash',
  incomingAccount: 'Bank',
  currencyCode: 'USD',
  outgoingNote: null,
  incomingNote: null,
};

beforeEach(() => {
  for (const read of [listReviewCandidates, confirmCandidate, rejectCandidate])
    jest.mocked(read).mockReset();
});

async function renderScreen() {
  const view = await renderWithQueries(<ReviewQueueScreen />);
  return view;
}

test('first load shows a skeleton, then the candidates', async () => {
  const read = Promise.withResolvers<ReviewCandidate[]>();
  jest.mocked(listReviewCandidates).mockReturnValue(read.promise);
  await renderScreen();

  expect(screen.getByLabelText('Loading transfer candidates')).toBeOnTheScreen();
  await act(async () => read.resolve([candidate]));

  expect(screen.queryByLabelText('Loading transfer candidates')).not.toBeOnTheScreen();
  expect(screen.getByText('Cash → Bank')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeEnabled();
});

test('a failed first load shows an error, and Retry reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listReviewCandidates).mockRejectedValueOnce(new Error('Read failed'));
  await renderScreen();

  expect(await screen.findByText('Could not load transfer candidates.')).toBeOnTheScreen();
  jest.mocked(listReviewCandidates).mockResolvedValue([candidate]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('Cash → Bank')).toBeOnTheScreen();
  expect(screen.queryByText('Could not load transfer candidates.')).not.toBeOnTheScreen();
});

test('a failed refresh keeps the candidates and shows an alert with Retry', async () => {
  const user = userEvent.setup();
  jest.mocked(listReviewCandidates).mockResolvedValue([candidate]);
  await renderScreen();
  expect(await screen.findByText('Cash → Bank')).toBeOnTheScreen();

  jest.mocked(listReviewCandidates).mockRejectedValue(new Error('Refresh failed'));
  await act(async () => notifyDataChanged());

  expect(await screen.findByText('Could not refresh transfer candidates.')).toBeOnTheScreen();
  expect(screen.getByText('Cash → Bank')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeEnabled();

  jest.mocked(listReviewCandidates).mockResolvedValue([]);
  await user.press(screen.getByRole('button', { name: 'Retry' }));

  expect(await screen.findByText('No transfer candidates to review.')).toBeOnTheScreen();
  expect(screen.queryByText('Could not refresh transfer candidates.')).not.toBeOnTheScreen();
});

test('a data change refreshes the candidates and disables the actions while it reads', async () => {
  jest.mocked(listReviewCandidates).mockResolvedValue([candidate]);
  await renderScreen();
  expect(await screen.findByText('Cash → Bank')).toBeOnTheScreen();

  const refresh = Promise.withResolvers<ReviewCandidate[]>();
  jest.mocked(listReviewCandidates).mockReturnValue(refresh.promise);
  await act(async () => notifyDataChanged());

  expect(screen.getByText('Cash → Bank')).toBeOnTheScreen();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeDisabled(),
  );
  await act(async () => refresh.resolve([{ ...candidate, id: 8, outgoingAccount: 'Card' }]));

  expect(await screen.findByText('Card → Bank')).toBeOnTheScreen();
  expect(screen.queryByText('Cash → Bank')).not.toBeOnTheScreen();
  expect(screen.getByRole('button', { name: 'Confirm transfer' })).toBeEnabled();
});

test('Confirm and Reject ask first, write once, and report a failed write', async () => {
  const user = userEvent.setup();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(listReviewCandidates).mockResolvedValue([candidate]);
  await renderScreen();

  await user.press(await screen.findByRole('button', { name: 'Confirm transfer' }));
  expect(alert.mock.calls.at(-1)?.[0]).toBe('Confirm transfer?');
  expect(confirmCandidate).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());
  expect(confirmCandidate).toHaveBeenCalledWith(7);

  jest.mocked(rejectCandidate).mockRejectedValue(new Error('Candidate is gone'));
  await user.press(screen.getByRole('button', { name: 'Reject match' }));
  expect(alert.mock.calls.at(-1)?.[0]).toBe('Keep separate transactions?');
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());

  expect(rejectCandidate).toHaveBeenCalledWith(7);
  expect(alert).toHaveBeenLastCalledWith('Could not resolve candidate', 'Error: Candidate is gone');
  expect(screen.getByRole('button', { name: 'Reject match' })).toBeEnabled();
  alert.mockRestore();
});

test('a failed write reads the queue again and removes a candidate that is gone', async () => {
  const user = userEvent.setup();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.mocked(listReviewCandidates).mockResolvedValue([candidate]);
  await renderScreen();

  jest.mocked(rejectCandidate).mockRejectedValue(new Error('Candidate is gone'));
  jest.mocked(listReviewCandidates).mockResolvedValue([]);
  await user.press(await screen.findByRole('button', { name: 'Reject match' }));
  await act(async () => alert.mock.calls.at(-1)?.[2]?.[1].onPress?.());

  expect(await screen.findByText('No transfer candidates to review.')).toBeOnTheScreen();
  alert.mockRestore();
});

function Reopen() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Toggle screen"
        onPress={() => setOpen((value) => !value)}
      />
      {open && <ReviewQueueScreen />}
    </>
  );
}

test('a screen that opens again after a failed read reads again', async () => {
  const user = userEvent.setup();
  jest.mocked(listReviewCandidates).mockRejectedValueOnce(new Error('Read failed'));
  await renderWithQueries(<Reopen />);
  expect(await screen.findByText('Could not load transfer candidates.')).toBeOnTheScreen();

  jest.mocked(listReviewCandidates).mockResolvedValue([candidate]);
  await user.press(screen.getByRole('button', { name: 'Toggle screen' }));
  await user.press(screen.getByRole('button', { name: 'Toggle screen' }));

  expect(await screen.findByText('Cash → Bank')).toBeOnTheScreen();
});
