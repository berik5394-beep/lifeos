import { typewriterSlice } from '@/hooks/use-typewriter';

describe('typewriterSlice — реплика робота печатается по буквам', () => {
  it('в начале пусто, со временем текст растёт, в конце — целиком', () => {
    expect(typewriterSlice('Привет', 0, 10)).toBe('');
    expect(typewriterSlice('Привет', 30, 10)).toBe('При');
    expect(typewriterSlice('Привет', 10_000, 10)).toBe('Привет');
  });
  it('эмодзи не режутся пополам', () => {
    expect(typewriterSlice('Ок 🥹!', 40, 10)).toBe('Ок 🥹');
  });
});
