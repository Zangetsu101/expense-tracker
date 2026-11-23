import { useState } from 'react';
import { Text, View } from 'react-native';
import { ChoiceChip } from '@/components/entry-choices';
import { Disclosure, FormInput } from '@/components/form-controls';
import type { Person } from '@/lib/lending';
import { formatBalance, formatMoney } from '@/lib/transaction-format';
import { splitShares } from '@/lib/reimbursements';
import { theme } from '@/theme';
import { ChoicesSection } from './view';
import { peopleQuery } from './queries';

const c = theme.colors;
export type PersonChoice = Person | { id: string; name: string };
export function isConfirmedPerson(person: PersonChoice): person is Person {
  return typeof person.id === 'number';
}

export type SplitDraft = { people: Person[]; fixed: Partial<Record<number, number>> };

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
  onChange,
  onAddPerson,
}: {
  draft: Omit<SplitDraft, 'people'> & { people: PersonChoice[] };
  amount: number;
  currency?: string;
  disabled: boolean;
  onChange: (draft: SplitDraft) => void;
  onAddPerson: (name: string, onCreated: (person: Person) => void) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const people = draft.people.filter(isConfirmedPerson);
  const { shares, yours } = splitShares(
    amount,
    people.map((person) => person.id),
    draft.fixed,
  );
  const money = (minor: number) => formatBalance(minor, currency ?? 'BDT');
  const needle = search.trim().toLocaleLowerCase();
  function toggle(person: Person) {
    const fixed = { ...draft.fixed };
    delete fixed[person.id];
    onChange({
      fixed,
      people: people.some(({ id }) => id === person.id)
        ? people.filter(({ id }) => id !== person.id)
        : [...people, person],
    });
  }
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: c.muted, fontSize: 12 }}>Split · optional</Text>
      <Disclosure
        expanded={open}
        disabled={disabled}
        label={
          open || !people.length
            ? 'Split with people'
            : `With ${people.map((p) => p.name).join(', ')} · your share ${money(yours)}`
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
              const provisional = draft.people.filter((person) => !isConfirmedPerson(person));
              const choices: PersonChoice[] = [
                ...available.filter(
                  (person) => !provisional.some((choice) => choice.name === person.name),
                ),
                ...provisional,
              ];
              return (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  {choices
                    .filter((person) => person.name.toLocaleLowerCase().includes(needle))
                    .map((person) => (
                      <ChoiceChip
                        key={person.id}
                        label={person.name}
                        disabled={disabled || !isConfirmedPerson(person)}
                        selected={draft.people.some(({ id }) => id === person.id)}
                        onPress={isConfirmedPerson(person) ? () => toggle(person) : undefined}
                      />
                    ))}
                  {!!needle &&
                    !available.some((person) => person.name.toLocaleLowerCase() === needle) && (
                      <ChoiceChip
                        label={`Add “${search.trim()}”`}
                        disabled={disabled}
                        onPress={() => {
                          onAddPerson(search, (created) => {
                            toggle(created);
                            setSearch('');
                          });
                        }}
                      />
                    )}
                </View>
              );
            }}
          </ChoicesSection>
          {people.length ? (
            <>
              <Text style={{ color: c.muted, fontSize: 12 }}>Shares</Text>
              <View style={{ backgroundColor: c.surface, paddingHorizontal: 14, borderRadius: 14 }}>
                {shares.map((share, index) => (
                  <View
                    key={share.personId}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 8,
                      paddingVertical: 8,
                      borderBottomWidth: 1,
                      borderColor: c.line,
                    }}
                  >
                    <Text style={{ color: c.text, flex: 1 }}>{people[index].name}</Text>
                    <ShareField
                      name={people[index].name}
                      amount={share.amountMinor}
                      disabled={disabled}
                      fixed={draft.fixed[share.personId] !== undefined}
                      onChange={(minor) =>
                        onChange({ people, fixed: { ...draft.fixed, [share.personId]: minor } })
                      }
                    />
                  </View>
                ))}
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
          ) : draft.people.length === 0 ? (
            <Text style={{ color: c.muted }}>Pick people to split with.</Text>
          ) : null}
        </>
      )}
    </View>
  );
}
