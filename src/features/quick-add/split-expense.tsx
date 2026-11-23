import { useState, type Dispatch, type SetStateAction } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { ChoiceChip } from '@/components/entry-choices';
import { Disclosure, FormInput } from '@/components/form-controls';
import type { Person } from '@/lib/lending';
import { formatBalance, formatMoney } from '@/lib/transaction-format';
import { splitShares } from '@/lib/reimbursements';
import { theme } from '@/theme';
import { ChoicesSection } from './view';
import { peopleQuery } from './queries';

const c = theme.colors;
export type SplitDraft = { people: Person[]; fixed: Partial<Record<number, number>> };

export function withPendingPerson(people: readonly Person[], pending: Person | null): Person[] {
  if (!pending) return [...people];
  return [...people.filter((item) => item.id !== pending.id), pending].sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

export function removeSplitPerson(draft: SplitDraft, personId: number): SplitDraft {
  const hasPerson = draft.people.some((person) => person.id === personId);
  const hasFixed = draft.fixed[personId] !== undefined;
  if (!hasPerson && !hasFixed) return draft;
  const fixed = { ...draft.fixed };
  delete fixed[personId];
  return {
    people: draft.people.filter((person) => person.id !== personId),
    fixed,
  };
}

function ShareField({
  name,
  amount,
  fixed,
  disabled,
  onChange,
}: {
  name: string;
  amount: number;
  fixed: boolean;
  disabled: boolean;
  onChange: (amount: number) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const formatted = (amount / 100).toFixed(2);
  return (
    <FormInput
      accessibilityLabel={`Share for ${name}`}
      inputMode="decimal"
      value={editing ?? formatted}
      editable={!disabled}
      selectTextOnFocus
      onBlur={() => setEditing(null)}
      onChangeText={(value) => {
        const normalized = value.replace(',', '.');
        if (!/^\d*(?:\.\d{0,2})?$/.test(normalized)) return;
        const [whole, fraction = ''] = normalized.split('.');
        const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
        if (!Number.isSafeInteger(minor)) return;
        setEditing(value);
        onChange(minor);
      }}
      style={{ minWidth: 96, textAlign: 'right', borderColor: fixed ? c.accent : c.line }}
    />
  );
}

export function SplitExpense({
  draft,
  amount,
  currency,
  disabled,
  pendingPerson,
  onChange,
  onAddPerson,
}: {
  draft: SplitDraft;
  amount: number;
  currency?: string;
  disabled: boolean;
  pendingPerson: Person | null;
  onChange: Dispatch<SetStateAction<SplitDraft>>;
  onAddPerson: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const { shares, yours } = splitShares(
    amount,
    draft.people.map((person) => person.id),
    draft.fixed,
  );
  const money = (minor: number) => formatBalance(minor, currency ?? 'BDT');
  const needle = search.trim().toLocaleLowerCase();
  function toggle(person: Person) {
    onChange((current) => {
      const fixed = { ...current.fixed };
      delete fixed[person.id];
      return {
        fixed,
        people: current.people.some(({ id }) => id === person.id)
          ? current.people.filter(({ id }) => id !== person.id)
          : [...current.people, person],
      };
    });
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>Split · optional</Text>
      <Disclosure
        expanded={open}
        disabled={disabled}
        label={
          open || !draft.people.length
            ? 'Split with people'
            : `With ${draft.people.map((p) => p.name).join(', ')} · your share ${money(yours)}`
        }
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <FormInput
            accessibilityLabel="Find or add a person"
            placeholder="Find or add a person"
            value={search}
            onChangeText={setSearch}
            editable={!disabled}
          />
          <ChoicesSection options={peopleQuery()} label="people" layout="people">
            {({ people: available }) => {
              const choices = withPendingPerson(available, pendingPerson);
              return (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {choices
                    .filter((person) => person.name.toLocaleLowerCase().includes(needle))
                    .map((person) => (
                      <ChoiceChip
                        key={person.id}
                        label={person.name}
                        disabled={disabled}
                        pending={person.id === pendingPerson?.id}
                        selected={draft.people.some(({ id }) => id === person.id)}
                        onPress={() => toggle(person)}
                      />
                    ))}
                  {!!needle &&
                    !choices.some((person) => person.name.toLocaleLowerCase() === needle) && (
                      <ChoiceChip
                        label={`Add “${search.trim()}”`}
                        disabled={disabled || pendingPerson !== null}
                        onPress={() => {
                          onAddPerson(search);
                          setSearch('');
                        }}
                      />
                    )}
                </View>
              );
            }}
          </ChoicesSection>
          {draft.people.length ? (
            <>
              <Text style={{ color: c.muted, fontSize: 12 }}>Shares</Text>
              <View style={{ backgroundColor: c.surface, paddingHorizontal: 14, borderRadius: 14 }}>
                {shares.map((share, index) => {
                  const person = draft.people[index];
                  const isPending = person.id === pendingPerson?.id;
                  return (
                    <View
                      key={person.name.toLocaleLowerCase()}
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                        gap: 8,
                        paddingVertical: 8,
                        borderBottomWidth: 1,
                        borderColor: c.line,
                      }}
                    >
                      <View
                        style={{
                          flex: 1,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          opacity: isPending ? 0.7 : 1,
                        }}
                      >
                        <Text style={{ color: c.text, flexShrink: 1 }}>{person.name}</Text>
                        {isPending && <ActivityIndicator size="small" color={c.muted} />}
                      </View>
                      <ShareField
                        name={person.name}
                        amount={share.amountMinor}
                        disabled={disabled}
                        fixed={draft.fixed[share.personId] !== undefined}
                        onChange={(minor) =>
                          onChange((current) =>
                            current.people.some((item) => item.id === share.personId)
                              ? { ...current, fixed: { ...current.fixed, [share.personId]: minor } }
                              : current,
                          )
                        }
                      />
                    </View>
                  );
                })}
                <View
                  style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    paddingVertical: 14,
                  }}
                >
                  <Text style={{ color: c.muted }}>You</Text>
                  <Text style={{ color: yours < 0 ? c.warning : c.muted }}>{money(yours)}</Text>
                </View>
              </View>
              {yours < 0 && (
                <Text accessibilityRole="alert" style={{ color: c.warning }}>
                  The shares are {money(-yours)} more than the expense.
                </Text>
              )}
              <Text style={{ color: c.muted, fontSize: 12 }}>
                Even at first. Type a share to fix it. The others share the rest. Your Account still
                shows {formatMoney('EXPENSE', amount, currency ?? 'BDT')}.
              </Text>
            </>
          ) : (
            <Text style={{ color: c.muted }}>Pick people to split with.</Text>
          )}
        </>
      )}
    </View>
  );
}
