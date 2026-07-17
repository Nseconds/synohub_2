import { LoginForm } from "../../components/LoginForm";

interface LoginPageProps {
  onLoginSuccess: (user: { name: string; role: string; token: string }) => void;
}

export function LoginPage({ onLoginSuccess }: LoginPageProps) {
  return (
    <LoginForm
      onLoginSuccess={onLoginSuccess}
    />
  );
}
