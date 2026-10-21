import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect } from "vitest";
import { Field } from "../src/components/Field";
it("ラベルで入力にアクセスでき、説明が関連付く", async () => {
  render(<Field label="名前" hint="自由な呼び名" />);
  const input = screen.getByRole("textbox", { name: "名前" });
  await userEvent.type(input, "推し");
  expect(input).toHaveValue("推し");
  expect(input).toHaveAccessibleDescription("自由な呼び名");
});

it("呼び出し側の説明・エラーとヒントを共に関連付ける", () => {
  render(
    <>
      <p id="error">100文字以内で入力してください</p>
      <Field
        id="character-name"
        label="推しの名前"
        hint="呼び名も使えます"
        aria-describedby="error"
        aria-invalid="true"
      />
    </>,
  );
  const input = screen.getByRole("textbox", { name: "推しの名前" });
  expect(input).toHaveAttribute("id", "character-name");
  expect(input).toHaveAccessibleDescription(
    "呼び名も使えます 100文字以内で入力してください",
  );
  expect(input).toHaveAttribute("aria-invalid", "true");
});

it("ヒントなしでも呼び出し側の説明を保つ", () => {
  render(
    <>
      <p id="note">任意です</p>
      <Field label="メモの見出し" aria-describedby="note" />
    </>,
  );
  expect(
    screen.getByRole("textbox", { name: "メモの見出し" }),
  ).toHaveAccessibleDescription("任意です");
});
