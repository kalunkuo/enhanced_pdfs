using System.Globalization;
using Autodesk.Revit.DB;
using MarkupReview.Core;

namespace EnhancedPdfs.Review;

/// <summary>Applies one approved proposal in its own named transaction. Must run on Revit's API thread.</summary>
internal static class ApplyChange
{
    /// <returns>Null on success, otherwise the reason it was not applied (the transaction is rolled back).</returns>
    public static string? Apply(Document document, ExportedElement exported, Proposal proposal)
    {
        var element = document.GetElement(exported.UniqueId);
        if (element is null) return "Element no longer in model.";

        using var transaction = new Transaction(document, TransactionName(element, proposal));
        transaction.Start();
        try
        {
            string? error = proposal.Change switch
            {
                SetParameter set => SetValue(document, element, set, proposal.NewValue ?? set.Value),
                MarkupReview.Core.ChangeType swap => Swap(document, element, proposal.NewValue ?? swap.TypeName),
                _ => "Unsupported change.",
            };
            if (error is not null) { transaction.RollBack(); return error; }
            if (transaction.Commit() != TransactionStatus.Committed) return "Revit did not commit the change.";
            return null;
        }
        catch (Exception e)
        {
            if (transaction.HasStarted() && !transaction.HasEnded()) transaction.RollBack();
            return e.Message;
        }
    }

    public static string TransactionName(Element element, Proposal proposal)
    {
        string what = proposal.Change is SetParameter s ? s.Name : "Type";
        return $"Markup: {element.Category?.Name ?? "Element"} {element.Id.Value} {what}";
    }

    private static string? SetValue(Document document, Element element, SetParameter set, string value)
    {
        var p = RevitModelGateway.FindParameter(document, element, set.Name, set.Scope);
        if (p is null) return $"Parameter '{set.Name}' not found.";
        if (p.IsReadOnly) return $"Parameter '{p.Definition.Name}' is read-only.";

        bool ok = p.StorageType switch
        {
            StorageType.String => p.Set(value),
            StorageType.Integer when p.Definition.GetDataType() == SpecTypeId.Boolean.YesNo =>
                p.Set(string.Equals(value, "Yes", StringComparison.OrdinalIgnoreCase) ? 1 : 0),
            StorageType.Integer => p.SetValueString(value) ||
                (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out int i) && p.Set(i)),
            StorageType.Double => p.SetValueString(value),
            _ => false,
        };
        return ok ? null : $"Revit rejected '{value}' for '{p.Definition.Name}'.";
    }

    private static string? Swap(Document document, Element element, string typeName)
    {
        // typeName is the validator's family-qualified "Family: Name" — match exactly, never by bare name, so the
        // type applied is the one that was validated and shown (names repeat across families).
        var target = element.GetValidTypes()
            .Select(id => document.GetElement(id) as ElementType)
            .FirstOrDefault(t => t is not null && string.Equals($"{t.FamilyName}: {t.Name}", typeName, StringComparison.OrdinalIgnoreCase));
        if (target is null) return $"Type '{typeName}' is not available for this element.";
        element.ChangeTypeId(target.Id);
        return null;
    }
}
