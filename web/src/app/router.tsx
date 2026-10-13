import { createBrowserRouter } from "react-router-dom";
import { Splash } from "@/features/journey/Splash";
import { Create } from "@/features/create/Create";
import { AgreementHub } from "@/features/agreement/AgreementHub";
import { Buy } from "@/features/buy/Buy";
import { Deposit } from "@/features/deposit/Deposit";
import { Claim } from "@/features/claim/Claim";
import { TransferLab } from "@/features/transfer-lab/TransferLab";
import { Admin } from "@/features/admin/Admin";
import { WindDown } from "@/features/wind-down/WindDown";
import { Closer } from "@/features/journey/Closer";
import { OpenAgreement } from "@/features/agreement/OpenAgreement";
import { MathDev } from "@/features/dev/MathDev";

export const router = createBrowserRouter([
  { path: "/", element: <Splash /> },
  { path: "/create", element: <Create /> },
  { path: "/open", element: <OpenAgreement /> },
  { path: "/a/:config", element: <AgreementHub /> },
  { path: "/a/:config/buy", element: <Buy /> },
  { path: "/a/:config/deposit", element: <Deposit /> },
  { path: "/a/:config/claim", element: <Claim /> },
  { path: "/a/:config/transfer", element: <TransferLab /> },
  { path: "/a/:config/admin", element: <Admin /> },
  { path: "/a/:config/wind-down", element: <WindDown /> },
  { path: "/closer", element: <Closer /> },
  { path: "/dev/math", element: <MathDev /> },
]);
