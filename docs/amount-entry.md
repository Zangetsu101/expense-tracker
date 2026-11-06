# Amount keypad

Quick Add uses a custom calculator keypad on iOS and Android because the system decimal keyboards do not provide arithmetic operators. It occupies the bottom of the screen below the scrollable form, like a keyboard, and uses the existing app palette. Amount focus opens it; Done, blur, interaction with other form controls, scrolling, and Android Back dismiss it. The first Back closes the keypad while retaining the entry screen.

Keys update the Amount field directly. Arithmetic follows multiplication/division precedence and rounds the final result to two decimal places. Done and dismissal resolve valid expressions; incomplete expressions remain editable and prevent saving. Equals continues calculation, with the next digit starting fresh. No separate apply/cancel calculator step is needed.
