import { useState, useTransition } from 'react';
import {
  createAccount,
  reverseAmountSign,
  updateAccount,
  type ManagedAccount,
} from '@/lib/accounts';
import { AddAccountSheet, type AccountForm } from './view';

const emptyForm: AccountForm = { name: '', currencyCode: '', openingBalance: '0' };

export function useAccountSheet(accounts: ManagedAccount[]) {
  const [form, setForm] = useState(emptyForm);
  const [sheet, setSheet] = useState(false);
  const [pending, startSave] = useTransition();
  const [formError, setFormError] = useState<string>();

  function save() {
    if (pending) return;
    setFormError(undefined);
    startSave(async () => {
      try {
        const input = {
          ...form,
          openingBalance: form.isCreditCard
            ? reverseAmountSign(form.openingBalance)
            : form.openingBalance,
        };
        if (form.id) await updateAccount(form.id, input);
        else await createAccount(input);
        setForm(emptyForm);
        setSheet(false);
      } catch (error) {
        setFormError(String(error));
      }
    });
  }
  function edit(account: ManagedAccount) {
    setForm({
      id: account.id,
      name: account.name,
      currencyCode: account.currencyCode,
      openingBalance: String(
        (account.card ? -account.openingBalanceMinor : account.openingBalanceMinor) / 100,
      ),
      isCreditCard: !!account.card,
      isInvestment: !!account.isInvestment,
      parentAccountId: account.card?.parentAccountId,
      statementDay: account.card?.statementDay,
      dueDay: account.card?.dueDay,
    });
    setFormError(undefined);
    setSheet(true);
  }
  function add() {
    setForm(emptyForm);
    setFormError(undefined);
    setSheet(true);
  }
  return {
    pending,
    edit,
    add,
    sheet: sheet && (
      <AddAccountSheet
        accounts={accounts}
        form={form}
        onChange={setForm}
        pending={pending}
        error={formError}
        onSave={save}
        onClose={() => setSheet(false)}
      />
    ),
  };
}
