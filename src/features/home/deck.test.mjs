import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cardIndex, deckCards, pageDots } from './deck.ts';

const account = (id, name, lastUsedDay = null, isFavorite = 0) => ({
  id,
  name,
  currencyCode: 'BDT',
  isFavorite,
  balanceMinor: 0,
  lastUsedDay,
});

test('the deck starts with All accounts, then the favorite, then recent use, then the rest by name', () => {
  const cards = deckCards([
    account(1, 'Zeta'),
    account(2, 'Bank', 100),
    account(3, 'Cash', 50, 1),
    account(4, 'Alpha'),
    account(5, 'bKash', 120),
    account(6, 'Card', 100),
  ]);
  assert.deepEqual(
    cards.map((card) => [card.accountId, card.face]),
    [
      [null, 'pace'],
      [3, 'trend'],
      [5, 'trend'],
      [2, 'trend'],
      [6, 'trend'],
      [4, 'trend'],
      [1, 'trend'],
    ],
  );
  assert.equal(cards[0].account, null);
  assert.equal(cards[1].account.name, 'Cash');
});

test('one account gets a single Pace card for that account', () => {
  const cards = deckCards([account(7, 'Cash', null, 1)]);
  assert.deepEqual(
    cards.map((card) => [card.accountId, card.face, card.account?.name]),
    [[7, 'pace', 'Cash']],
  );
});

test('no accounts keeps the All accounts card', () => {
  assert.deepEqual(
    deckCards([]).map((card) => [card.accountId, card.face]),
    [[null, 'pace']],
  );
});

test('page dots hide for one card and show every card up to seven', () => {
  assert.deepEqual(pageDots(1, 0), []);
  assert.deepEqual(
    pageDots(3, 1).map((dot) => [dot.active, dot.size]),
    [
      [false, 'full'],
      [true, 'full'],
      [false, 'full'],
    ],
  );
  assert.deepEqual(
    pageDots(7, 0).map((dot) => dot.size),
    Array(7).fill('full'),
    'seven cards fit without smaller dots',
  );
  assert.deepEqual(
    pageDots(8, 0).map((dot) => dot.size),
    ['full', 'full', 'full', 'full', 'full', 'medium', 'small'],
    'an eighth card makes the far edge smaller',
  );
});

test('page dots show at most seven and shrink at an edge with more cards past it', () => {
  const sizes = (index) =>
    pageDots(13, index)
      .map((dot) => (dot.active ? 'on' : dot.size))
      .join(' ');
  assert.equal(sizes(0), 'on full full full full medium small');
  assert.equal(sizes(6), 'small medium full on full medium small');
  assert.equal(sizes(12), 'small medium full full full full on');
  assert.deepEqual(
    pageDots(13, 6).map((dot) => dot.index),
    [3, 4, 5, 6, 7, 8, 9],
  );
});

test('cardIndex finds the card of an Account and falls back to the first card', () => {
  const cards = deckCards([account(1, 'Cash', null, 1), account(2, 'Bank')]);
  assert.equal(cardIndex(cards, 2), 2);
  assert.equal(cardIndex(cards, null), 0);
  assert.equal(cardIndex(cards, 99), 0);
});
