import { z } from "zod";
import { emailField } from "./crm";

/** Password policy — enforced on the server, mirrored by the client form. */
export const passwordSchema = z
  .string()
  .min(12, "Das Passwort muss mindestens 12 Zeichen lang sein.")
  .max(200)
  .refine((value) => /[a-z]/.test(value), "Das Passwort muss einen Kleinbuchstaben enthalten.")
  .refine((value) => /[A-Z]/.test(value), "Das Passwort muss einen Großbuchstaben enthalten.")
  .refine((value) => /[0-9]/.test(value), "Das Passwort muss eine Ziffer enthalten.");

export const registerSchema = z.object({
  name: z.string().trim().min(2, "Bitte den vollständigen Namen angeben.").max(80),
  email: emailField,
  password: passwordSchema,
  organizationName: z.string().trim().min(2, "Bitte den Namen der Organisation angeben.").max(120),
});

export const loginSchema = z.object({
  email: emailField,
  password: z.string().min(1, "Bitte das Passwort eingeben.").max(200),
});

export const acceptInvitationSchema = z.object({
  token: z.string().min(10).max(200),
  name: z.string().trim().min(2).max(80),
  password: passwordSchema,
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

export const profileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  timezone: z.string().max(60),
  locale: z.string().max(10),
});
