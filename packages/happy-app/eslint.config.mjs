import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
    {
        files: ["sources/**/*.tsx"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                ecmaFeatures: { jsx: true },
            },
        },
        plugins: {
            react: reactPlugin,
            // Register these plugins so existing eslint-disable comments
            // referencing their rules don't cause "Definition not found" errors.
            "react-hooks": reactHooksPlugin,
            "@typescript-eslint": tsPlugin,
        },
        // Specify the React version explicitly — "detect" uses a deprecated ESLint
        // API (context.getFilename) that was removed in ESLint 9 flat config.
        settings: { react: { version: "19.2.0" } },
        rules: {
            // Prevent bare string/number values leaking into <View> in React Native.
            // When `stringVar` is "" or `numVar` is 0, `{val && <Component/>}`
            // renders a text node inside a View, which crashes on RN.
            //
            // Safe alternatives:
            //   {!!value && <Component/>}        — coerce to boolean
            //   {value ? <Component/> : null}    — explicit ternary
            "react/jsx-no-leaked-render": [
                "warn",
                { validStrategies: ["coerce", "ternary"] },
            ],
        },
    },
];
