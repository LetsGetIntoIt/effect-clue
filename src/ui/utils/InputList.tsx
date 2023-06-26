import { signal } from "@preact/signals";

interface Props<T> {
	readonly value: readonly T[];
	readonly onChange?: (value: readonly T[]) => void;
}

export function InpuList<T>({
	value,
	onChange = constUndefined,
}: Props<T>) {
	return (
		
	);
}
