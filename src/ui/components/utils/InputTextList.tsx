import { useSignal } from '@preact/signals';

import './InputTextList.module.css';
import { ifEnter } from '../../utils/forms';

function InputTextList({
  value,
  onChange = () => undefined,

  confirmRemove,
  placeholderCreate,
}: {
  value: string[],
  onChange?: (newValue: string[]) => void;

  confirmRemove: string;
  placeholderCreate: string;
}) {
  const newValue = useSignal('');

  const onEdit = (index: number, newValue: string) => {
    const copy = [...value];
    copy[index] = newValue;
    onChange(copy);
  }

  const handleRemove = (index: number) => {
    if (window.confirm(confirmRemove)) {
      const copy = [...value];
      copy.splice(index, 1);
      onChange(copy);
    }
  }

  const handleCreate = (created: string) => {
    newValue.value = '';
    onChange([...value, created]);
  }

  return (
    <ul class="list">
      {value.map((value, index) => (
        <li key={value} class="list-item">
          <input type="text" value={value} onInput={evt => onEdit(index, evt.target?.value)} />
          <button onClick={() => handleRemove(index)}>x</button>
        </li>
      ))}

      <li class="list-item">
        <input type="text" value={newValue.value} placeholder={placeholderCreate} onInput={evt => newValue.value = evt.target?.value} onKeyPress={ifEnter(() => handleCreate(newValue.value))} />
        <button onClick={() => handleCreate(newValue.value)}>+</button>
      </li>
    </ul>
  );
}

export default InputTextList;